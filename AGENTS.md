# AGENTS.md - Instructions for AI Assistants

> **This file is for you, the AI assistant.** It contains context and guidelines for working with the arveldaja-proxy project. (`CLAUDE.md` is a symlink to this file.)

## Project Overview

**arveldaja-proxy** is a safety layer for the Estonian e-Financials (e-arveldaja) API. Its purpose is to allow AI agents to freely read bookkeeping data while ensuring all write operations require human approval.

**Key Principle:** Agents can READ and PROPOSE changes, but cannot EXECUTE changes without human approval.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  AI Agent   │────▶│  arveldaja-proxy │────▶│ e-Financials API │
│  (You)      │     │  (Safety Layer)  │     │  (Real System)   │
└─────────────┘     └─────────────────┘     └──────────────────┘
                            │
                            ▼
                    ┌──────────────────┐
                    │  Human Review    │
                    │  (Web UI)        │
                    └──────────────────┘
```

**Flow:**
1. **GET requests** → Pass through directly to e-Financials API
2. **Write requests** (POST/PUT/PATCH/DELETE) → Captured in SQLite queue → Human reviews → Human approves/rejects → Only then executed

## MCP Server Usage

When interacting with this project via MCP, you have access to these tools:

### 1. query_api - READ Operations (Safe)

Query any e-Financials API endpoint freely. These pass through directly.

**Examples:**
```
query_api with endpoint: "/accounts" → Returns all chart of accounts
query_api with endpoint: "/journals" → Returns all journal entries
query_api with endpoint: "/vat_info" → Returns VAT registration info
```

### 2. propose_change - WRITE Operations (Captured)

Propose changes to the system. These are NOT executed immediately - they are captured for human approval.

**When to use:**
- Creating new journal entries
- Updating existing transactions
- Deleting records
- Any modification to financial data

**Example:**
```
propose_change:
  endpoint: "/journals"
  method: "POST"
  body: {
    "no": "J-2024-001",
    "effective_date": "2024-01-15",
    "description": "Office supplies purchase",
    "transactions": [
      {"debit_account": "5140", "credit_account": "1020", "amount": "125.50"}
    ]
  }
  description: "Record office supplies expense"
```

**Notes:**
- `body` is required for POST, PUT, and PATCH (not for DELETE)
- `data` is accepted as a deprecated alias for `body` — always use `body`
- To group related changes (e.g. all entries of a month-end closing) into one review, first call `create_changeset` and pass the returned ID as `changesetId` on each proposal. Omitting `changesetId` auto-creates a single-change changeset.

**Response will be:**
```json
{
  "message": "Change proposed and captured for human approval",
  "status": "pending",
  "changesetId": "uuid-here",
  "changeId": "uuid-here",
  "note": "This change is NOT executed yet. A human must review and approve it..."
}
```

### 3. create_changeset - Group Related Proposals

Create a named changeset, then pass its ID as `changesetId` to `propose_change` so the human can review and approve the whole group at once.

### 4. list_pending_changes - Check Status and Outcomes

Defaults to changes awaiting human approval. Accepts optional `changesetId` and `status` filters; with `status: "approved"` or `"rejected"` the results include the execution `response` or the rejection/execution `error`, so you can see why a change was rejected or what the API returned.

### 5. list_changesets / get_changeset_details - Review Groupings

Changesets group related changes together. Use these to see the overall state. `list_changesets` accepts an optional `status` filter (`pending`, `approved`, `rejected`). `get_changeset_details` includes each change's `response`/`error` once resolved.

## Important Guidelines

### ✅ DO
- Always use `query_api` to fetch data before proposing changes
- Provide clear, descriptive `description` when proposing changes
- Use `list_pending_changes` to check if the user has approved previous proposals
- Explain to the user what you're proposing and why
- Wait for human approval before assuming changes are live

### ❌ DON'T
- NEVER assume a `propose_change` has been executed immediately
- NEVER try to bypass the approval system
- NEVER make multiple conflicting proposals without checking status
- NEVER delete or modify pending changesets directly

## Understanding the Data

### Account Codes
The e-Financials system uses Estonian standard chart of accounts:
- **1000-1999** - Assets (Varad)
- **2000-2999** - Liabilities (Kohustused)
- **3000-3999** - Equity (Omakapital)
- **4000-4999** - Revenue (Tulu)
- **5000-6999** - Expenses (Kulud)

Common accounts:
- **1020** - Bank account (Pank)
- **2030** - Accounts payable (Võlad tarnijatele)
- **5140** - Office supplies (Kontoritarbed)
- **5310** - Banking fees (Pangateenustasud)
- **6000** - Rent expense (Üür)

### Journal Entry Format
When proposing journal entries, use the simplified transaction format:

```json
{
  "no": "Journal Number",
  "effective_date": "YYYY-MM-DD",
  "description": "Description",
  "transactions": [
    {
      "debit_account": "5140",
      "credit_account": "1020", 
      "amount": "125.50"
    }
  ]
}
```

The proxy automatically converts this to the API's `postings` format.
If a journal payload has `description` but no `title`, the proxy also sets `title = description` before execution.

## Environment

The project connects to the **demo environment** by default:
- Base URL: `https://demo-rmp-api.rik.ee/v1` (override with `API_BASE_URL`)
- Authentication: HMAC-SHA-384 signing (`API_KEY_ID`, `API_KEY_PUBLIC`, `API_KEY_PASSWORD`)
- Database: SQLite (`pending_changes.db` in the project root by default, override with `DB_PATH`; resolved relative to the code so the Express server and the standalone stdio MCP server always find the same file)
- MCP transport: the Express server exposes the MCP server at `POST /mcp` (Streamable HTTP, stateless) — the recommended setup, one process and one DB handle. `dist/mcp-server.js` remains as a standalone stdio entry for clients that need it.

Optional hardening env vars (see `.env.example`):
- `ALLOWED_ORIGINS` - CORS allowlist for browser clients (defaults to the local review UI)
- `MCP_ALLOWED_HOSTS` - `Host` headers accepted on `/mcp` (DNS rebinding protection; defaults to localhost variants)
- `PROXY_AUTH_TOKEN` - when set, all mutating requests (proxy writes, approvals, rejections, deletes) must carry the token via `Authorization: Bearer <token>` or `X-Proxy-Token`. MCP-over-HTTP messages are all POSTs, so MCP clients must send the token too (it is a proxy access token, not an API credential, so it may appear in MCP client config)

## File Structure

```
public/
└── index.html            # Review web UI (single page)
src/
├── index.ts              # Main Express server (CORS, auth guard, proxy routes)
├── mcp-server.ts         # Standalone stdio entry for the MCP server
├── db/
│   └── index.ts          # Database operations
├── mcp/
│   └── server.ts         # MCP server factory (tools and handlers)
├── middleware/
│   └── capture.ts        # Request interception
├── routes/
│   ├── api.ts            # Change management API
│   ├── changesets.ts     # Changeset management API
│   ├── company.ts        # Company info and balance aggregation
│   └── mcp.ts            # MCP over Streamable HTTP (/mcp)
├── types/
│   └── index.ts          # Shared TypeScript types
└── utils/
    ├── auth.ts           # HMAC-SHA-384 signing
    ├── executor.ts       # Forward reads, execute approved changes
    └── locks.ts          # In-process locks against double approval
```

## Working on the Codebase

```bash
npm run dev        # Run with hot reload (tsx watch)
npm run build      # Compile TypeScript
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

There is no test suite; CI validates PRs with `lint`, `typecheck`, and `build` — run those before claiming a change works. Note that Express 5 route syntax is used (named wildcards like `/proxy/*splat`, brace groups like `/review{/:id}`).

## When Helping Users

1. **Explain the safety model** - Make sure users understand that writes require approval
2. **Show, don't hide** - Always show the user what you're proposing before doing it
3. **Check status** - After proposing changes, offer to check if they've been approved
4. **Be patient** - Remind users that they need to review and approve in the web UI
5. **Guide to UI** - Point users to `http://localhost:3000/review` for approval

## Example Conversations

**User:** "Create a journal entry for office supplies"

**You:** "I'll help you create that journal entry. Let me first check the accounts and then propose the change for your approval."

[Use query_api to get accounts, then propose_change with clear description]

"I've proposed a journal entry to record €125.50 for office supplies:
- Debit: 5140 Office Supplies (Kontoritarbed)
- Credit: 1020 Bank Account (Pank)

This change has been captured and is pending your approval. Please visit http://localhost:3000/review to approve or reject it. The changeset ID is `abc-123` if you'd like to check its status later."

---

**User:** "Did my changes from earlier get approved?"

**You:** "Let me check the status of your pending changes."

[Use list_pending_changes or list_changesets]

"You have 2 changesets awaiting approval:
1. 'Month-end Closing' (3 changes) - Pending
2. 'Invoice corrections' (1 change) - Pending

Would you like me to show you the details of any specific changeset?"

## Security Notes

- API credentials live only in the project root `.env` file, read directly by the node processes. They must never appear in MCP client configuration (`env` blocks), agent-readable files, or your output
- The database contains financial data - handle with care
- All actions are logged for audit purposes
- Never suggest disabling the approval system
