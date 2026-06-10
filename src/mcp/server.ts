/**
 * MCP server factory for arveldaja-proxy
 *
 * Provides AI assistants with read access to the e-Financials API through the
 * safety proxy. All write operations are captured for human approval.
 *
 * Key principle: Agents can READ and PROPOSE, but cannot EXECUTE without approval.
 *
 * Transport-agnostic: the returned Server is connected to a stdio transport by
 * src/mcp-server.ts and to a Streamable HTTP transport by src/routes/mcp.ts.
 */

import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getPendingChanges,
  getChangesets,
  getChangesetById,
  getChangesetWithChanges,
  createPendingChange,
  createChangeset,
  getOpeningBalances,
  setOpeningBalance,
  deleteOpeningBalance,
} from '../db';
import { forwardReadRequest } from '../utils/executor';
import { discoverAndStoreOpeningBalances } from '../utils/openingBalances';

// Where the human reviews proposals; must match the Express server's port.
const REVIEW_URL = `http://localhost:${process.env.PORT || 3000}/review`;

// Stored response/error payloads are JSON strings; parse for the agent but
// fall back to the raw string if a value isn't valid JSON.
function tryParseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'arveldaja-proxy-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'query_api',
          description: 'Query the e-Financials API through the safety proxy. Supports GET requests to read accounts, journals, transactions, invoices, etc. All write operations (POST/PUT/PATCH/DELETE) are captured and queued for human approval.',
          inputSchema: {
            type: 'object',
            properties: {
              endpoint: {
                type: 'string',
                description: 'API endpoint path (e.g., "/accounts", "/journals", "/vat_info")',
              },
              params: {
                type: 'object',
                description: 'Optional query parameters',
              },
            },
            required: ['endpoint'],
          },
        },
        {
          name: 'propose_change',
          description: 'Propose a change to the e-Financials API (create journal, update transaction, etc.). The change will be captured and queued for human approval - it will NOT be executed immediately. Returns a changeset ID for tracking. To group several related changes for a single review, first call create_changeset and pass its ID as changesetId on each proposal.',
          inputSchema: {
            type: 'object',
            properties: {
              endpoint: {
                type: 'string',
                description: 'API endpoint path (e.g., "/journals", "/transactions")',
              },
              method: {
                type: 'string',
                enum: ['POST', 'PUT', 'PATCH', 'DELETE'],
                description: 'HTTP method for the change',
              },
              body: {
                type: 'object',
                description: 'Request body payload for the change',
              },
              data: {
                type: 'object',
                description: 'Deprecated alias for request body payload (use body)',
              },
              description: {
                type: 'string',
                description: 'Human-readable description of what this change does (for the review UI)',
              },
              changesetId: {
                type: 'string',
                description: 'Optional: ID of an existing pending changeset (from create_changeset) to add this change to. Omit to auto-create a single-change changeset.',
              },
            },
            required: ['endpoint', 'method'],
          },
        },
        {
          name: 'create_changeset',
          description: 'Create an empty changeset to group related changes (e.g. all journal entries of a month-end closing) so the human can review and approve them together. Pass the returned ID as changesetId to propose_change.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Short name for the changeset (shown in the review UI)',
              },
              description: {
                type: 'string',
                description: 'Optional longer description of what the grouped changes accomplish',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'get_opening_balances',
          description: 'List the opening balances stored locally in the proxy. The e-Financials API does not expose the opening balances entered in e-arveldaja when bookkeeping was started there, so the proxy keeps them locally and adds them on top of journal-derived balances (e.g. in the review UI\'s chart of accounts). Positive amount = debit balance (assets), negative = credit balance (liabilities/equity); a complete set sums to zero.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'set_opening_balances',
          description: 'Set or remove locally stored opening balances (see get_opening_balances). This only adjusts the proxy\'s local balance reporting — it does NOT write anything to e-Financials, so no human approval is needed, but the human can see and edit the same values in the review UI. Pass amount 0 to remove an account\'s entry. Use when journal-derived balances differ from what e-arveldaja shows: the difference at any single date equals the missing opening balance.',
          inputSchema: {
            type: 'object',
            properties: {
              balances: {
                type: 'array',
                description: 'Opening balances to upsert (amount 0 removes the entry)',
                items: {
                  type: 'object',
                  properties: {
                    account: {
                      type: 'string',
                      description: 'Account code (e.g. "1020")',
                    },
                    amount: {
                      type: 'number',
                      description: 'Signed balance: positive = debit (assets), negative = credit (liabilities/equity). 0 removes the entry.',
                    },
                  },
                  required: ['account', 'amount'],
                },
              },
            },
            required: ['balances'],
          },
        },
        {
          name: 'discover_opening_balances',
          description: 'Find the opening balance journal in e-Financials and store its amounts as the proxy\'s local opening balances. Opening balances entered in e-arveldaja live in a journal with operation_type INITIAL that the /journals list hides, but GET /journals/{id} returns. Pass journalId if known (visible in e-arveldaja). Without it, the id gaps between the company\'s listed journals are probed in ascending order (the INITIAL journal sits among the earliest ids) — this issues up to maxProbes read requests and can take a minute. Read-only towards e-Financials; only the proxy\'s local opening_balances store is updated.',
          inputSchema: {
            type: 'object',
            properties: {
              journalId: {
                type: 'integer',
                description: 'Optional: id of the INITIAL journal, if known. Skips probing.',
              },
              maxProbes: {
                type: 'integer',
                description: 'Optional: probe budget when scanning for the journal (default 500, max 2000)',
              },
            },
          },
        },
        {
          name: 'list_pending_changes',
          description: 'List proposed changes and their review status. Defaults to changes awaiting human approval; pass status "approved" or "rejected" to see resolved changes including their execution result or rejection reason.',
          inputSchema: {
            type: 'object',
            properties: {
              changesetId: {
                type: 'string',
                description: 'Optional: filter by changeset ID',
              },
              status: {
                type: 'string',
                enum: ['pending', 'approved', 'rejected'],
                description: 'Optional: filter by status (default "pending")',
              },
            },
          },
        },
        {
          name: 'list_changesets',
          description: 'List all changesets with their status and change counts. Use this to see grouped changes awaiting approval.',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['pending', 'approved', 'rejected'],
                description: 'Filter by status (optional)',
              },
            },
          },
        },
        {
          name: 'get_changeset_details',
          description: 'Get detailed information about a changeset including all its changes. Use this to review what changes are pending in a specific changeset.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Changeset ID',
              },
            },
            required: ['id'],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'query_api':
          return await handleQueryApi(args);

        case 'propose_change':
          return await handleProposeChange(args);

        case 'create_changeset':
          return await handleCreateChangeset(args);

        case 'get_opening_balances':
          return await handleGetOpeningBalances();

        case 'set_opening_balances':
          return await handleSetOpeningBalances(args);

        case 'discover_opening_balances':
          return await handleDiscoverOpeningBalances(args);

        case 'list_pending_changes':
          return await handleListPendingChanges(args);

        case 'list_changesets':
          return await handleListChangesets(args);

        case 'get_changeset_details':
          return await handleGetChangesetDetails(args);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Handler implementations

async function handleQueryApi(args: any) {
  const endpoint = args.endpoint.startsWith('/') ? args.endpoint : `/${args.endpoint}`;
  const params = args.params || {};

  try {
    const result = await forwardReadRequest('GET', endpoint, params, {});

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `API Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleProposeChange(args: any) {
  const { endpoint, method, description } = args;
  const bodyPayload = args?.body ?? args?.data ?? null;

  if (!endpoint || !method) {
    throw new Error('endpoint and method are required');
  }

  const normalizedMethod = String(method).toUpperCase();
  const bodyRequiredMethods = ['POST', 'PUT', 'PATCH'];
  if (bodyRequiredMethods.includes(normalizedMethod) && bodyPayload === null) {
    throw new Error('body is required for POST, PUT, and PATCH methods');
  }

  // This simulates what the proxy does - capture the change
  // In reality, this would make the request to the proxy which captures it
  // But since we're the MCP server, we directly create the pending change

  // Attach to an existing changeset when requested, otherwise auto-create one
  let changesetId: string;
  if (args?.changesetId) {
    const existing = await getChangesetById(String(args.changesetId));
    if (!existing) {
      throw new Error(`Changeset not found: ${args.changesetId}`);
    }
    if (existing.status !== 'pending') {
      throw new Error(`Cannot add changes to a ${existing.status} changeset`);
    }
    changesetId = existing.id;
  } else {
    const changesetName = description
      ? `Proposed: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`
      : `Proposed ${normalizedMethod} to ${endpoint}`;

    const changeset = {
      id: randomUUID(),
      name: changesetName,
      description: description || `Proposed ${normalizedMethod} request to ${endpoint}`,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    };

    await createChangeset(changeset);
    changesetId = changeset.id;
  }

  // Create the pending change
  const change = {
    id: randomUUID(),
    changesetId,
    method: normalizedMethod,
    path: endpoint.startsWith('/') ? endpoint : `/${endpoint}`,
    originalUrl: endpoint,
    headers: { 'Content-Type': 'application/json' },
    body: bodyPayload === null ? null : JSON.stringify(bodyPayload),
    query: {},
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    response: null,
    error: null,
  };

  await createPendingChange(change);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Change proposed and captured for human approval',
          status: 'pending',
          changesetId,
          changeId: change.id,
          endpoint: change.path,
          method: change.method,
          body: bodyPayload,
          description: description || 'No description provided',
          note: `This change is NOT executed yet. A human must review and approve it via the web UI at ${REVIEW_URL}`,
        }, null, 2),
      },
    ],
  };
}

async function handleCreateChangeset(args: any) {
  const name = typeof args?.name === 'string' ? args.name.trim() : '';
  if (!name) {
    throw new Error('name is required');
  }

  const changeset = {
    id: randomUUID(),
    name,
    description: typeof args?.description === 'string' ? args.description.trim() : undefined,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };

  await createChangeset(changeset);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Changeset created',
          changesetId: changeset.id,
          name: changeset.name,
          status: 'pending',
          note: `Pass this changesetId to propose_change to group changes under this changeset. The human reviews it at ${REVIEW_URL}`,
        }, null, 2),
      },
    ],
  };
}

async function handleGetOpeningBalances() {
  const balances = await getOpeningBalances();
  const total = Math.round(balances.reduce((sum, b) => sum + b.amount, 0) * 100) / 100;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          balances,
          total,
          note: balances.length === 0
            ? 'No opening balances stored. Journal-derived balance reports may differ from e-arveldaja if opening balances were entered there when bookkeeping started.'
            : `These local amounts are added on top of journal-derived balances. A complete set should sum to zero (currently ${total}).`,
        }, null, 2),
      },
    ],
  };
}

async function handleSetOpeningBalances(args: any) {
  const entries = args?.balances;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('balances must be a non-empty array of { account, amount }');
  }

  const updated: { account: string; amount: number }[] = [];
  const removed: string[] = [];

  for (const entry of entries) {
    const account = typeof entry?.account === 'string' ? entry.account.trim() : '';
    const amount = Number(entry?.amount);
    if (!account || !Number.isFinite(amount)) {
      throw new Error(`Each entry needs an account code and a finite amount (got ${JSON.stringify(entry)})`);
    }

    const rounded = Math.round(amount * 100) / 100;
    if (rounded === 0) {
      await deleteOpeningBalance(account);
      removed.push(account);
    } else {
      await setOpeningBalance(account, rounded);
      updated.push({ account, amount: rounded });
    }
  }

  const all = await getOpeningBalances();
  const total = Math.round(all.reduce((sum, b) => sum + b.amount, 0) * 100) / 100;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Opening balances updated (local proxy data only — nothing was written to e-Financials)',
          updated,
          removed,
          allOpeningBalances: all,
          total,
          note: total !== 0
            ? `Warning: stored opening balances sum to ${total}, not 0. A complete opening balance set is double-entry balanced — an asset debit (e.g. bank) should be matched by an equity/liability credit (negative amount).`
            : 'Stored opening balances are balanced (sum 0).',
        }, null, 2),
      },
    ],
  };
}

async function handleDiscoverOpeningBalances(args: any) {
  const journalId = args?.journalId !== undefined ? Number(args.journalId) : undefined;
  const maxProbes = args?.maxProbes !== undefined ? Number(args.maxProbes) : undefined;

  if (journalId !== undefined && (!Number.isInteger(journalId) || journalId <= 0)) {
    throw new Error('journalId must be a positive integer');
  }
  if (maxProbes !== undefined && (!Number.isInteger(maxProbes) || maxProbes <= 0)) {
    throw new Error('maxProbes must be a positive integer');
  }

  const result = await discoverAndStoreOpeningBalances({ journalId, maxProbes });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Opening balances discovered and stored locally (nothing was written to e-Financials)',
          ...result,
          note: result.total !== 0
            ? `Warning: the extracted opening balances sum to ${result.total}, not 0 — check the source journal.`
            : 'The stored opening balances are balanced (sum 0) and will now be included in balance reports.',
        }, null, 2),
      },
    ],
  };
}

async function handleListPendingChanges(args: any) {
  const status: 'pending' | 'approved' | 'rejected' = args?.status || 'pending';
  const changes = await getPendingChanges(status, args?.changesetId);

  if (changes.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: status === 'pending'
            ? 'No pending changes found. All proposed changes have been reviewed.'
            : `No ${status} changes found.`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          changes.map((c) => ({
            id: c.id,
            method: c.method,
            path: c.path,
            status: c.status,
            changesetId: c.changesetId,
            createdAt: c.createdAt,
            body: c.body ? JSON.parse(c.body) : null,
            // Outcome of the human review: execution result for approved
            // changes, rejection reason / execution error for rejected ones.
            resolvedAt: c.resolvedAt,
            response: tryParseJson(c.response),
            error: c.error,
          })),
          null,
          2
        ),
      },
    ],
  };
}

async function handleListChangesets(args: any) {
  const changesets = await getChangesets(args?.status);

  if (changesets.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No changesets found.',
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          changesets.map((cs) => ({
            id: cs.id,
            name: cs.name,
            status: cs.status,
            changesCount: cs.changesCount,
            createdAt: cs.createdAt,
            description: cs.description,
          })),
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetChangesetDetails(args: any) {
  const result = await getChangesetWithChanges(args.id);

  if (!result) {
    return {
      content: [
        {
          type: 'text',
          text: `Changeset not found: ${args.id}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          changeset: {
            id: result.changeset.id,
            name: result.changeset.name,
            description: result.changeset.description,
            status: result.changeset.status,
            createdAt: result.changeset.createdAt,
            resolvedAt: result.changeset.resolvedAt,
            resolvedBy: result.changeset.resolvedBy,
          },
          changes: result.changes.map((c) => ({
            id: c.id,
            method: c.method,
            path: c.path,
            status: c.status,
            createdAt: c.createdAt,
            body: c.body ? JSON.parse(c.body) : null,
            resolvedAt: c.resolvedAt,
            resolvedBy: c.resolvedBy,
            response: tryParseJson(c.response),
            error: c.error,
          })),
        }, null, 2),
      },
    ],
  };
}
