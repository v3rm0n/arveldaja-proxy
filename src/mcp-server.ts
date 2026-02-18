#!/usr/bin/env node
/**
 * MCP Server for arveldaja-proxy
 * 
 * This MCP server provides AI assistants with read access to the e-Financials API
 * through the safety proxy. All write operations are captured for human approval.
 * 
 * Key principle: Agents can READ and PROPOSE, but cannot EXECUTE without approval.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initDatabase, getPendingChanges, getChangesets, getChangesetWithChanges } from './db/index.js';
import { forwardReadRequest } from './utils/executor.js';

// Server configuration
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
        description: 'Propose a change to the e-Financials API (create journal, update transaction, etc.). The change will be captured and queued for human approval - it will NOT be executed immediately. Returns a changeset ID for tracking.',
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
          },
          required: ['endpoint', 'method'],
        },
      },
      {
        name: 'list_pending_changes',
        description: 'List all pending changes that are awaiting human approval. Use this to check the status of proposed changes.',
        inputSchema: {
          type: 'object',
          properties: {
            changesetId: {
              type: 'string',
              description: 'Optional: filter by changeset ID',
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
  
  const { v4: uuidv4 } = await import('uuid');
  const { createPendingChange, createChangeset } = await import('./db/index.js');
  
  // Create a changeset for this change
  const changesetName = description 
    ? `Proposed: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`
    : `Proposed ${normalizedMethod} to ${endpoint}`;
  
  const changeset = {
    id: uuidv4(),
    name: changesetName,
    description: description || `Proposed ${normalizedMethod} request to ${endpoint}`,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };
  
  await createChangeset(changeset);
  
  // Create the pending change
  const change = {
    id: uuidv4(),
    changesetId: changeset.id,
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
          changesetId: changeset.id,
          changeId: change.id,
          endpoint: change.path,
          method: change.method,
          body: bodyPayload,
          description: description || 'No description provided',
          note: 'This change is NOT executed yet. A human must review and approve it via the web UI at http://localhost:3000/review',
        }, null, 2),
      },
    ],
  };
}

async function handleListPendingChanges(args: any) {
  const changes = await getPendingChanges('pending', args?.changesetId);
  
  if (changes.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No pending changes found. All proposed changes have been reviewed.',
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
            changesetId: c.changesetId,
            createdAt: c.createdAt,
            body: c.body ? JSON.parse(c.body) : null,
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
          })),
        }, null, 2),
      },
    ],
  };
}

// Start the server
async function main() {
  // Initialize database
  await initDatabase();
  console.error('Database initialized');
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
