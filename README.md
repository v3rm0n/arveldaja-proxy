# e-arveldaja Proxy

A safety layer proxy for Estonian e-Financials (e-arveldaja) API that allows AI agents to freely read bookkeeping data while capturing all write operations for human approval.

**Key Principle**: AI agents can READ and PROPOSE changes, but cannot EXECUTE changes without human approval.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Read-Only by Default**: AI agents can freely query all data (accounts, journals, transactions, invoices)
- **Write Protection**: All POST/PATCH/PUT/DELETE operations are captured and queued for approval
- **Beautiful UI**: Web interface with specialized visualization for double-entry bookkeeping
- **MCP Server**: AI assistants can interact through Model Context Protocol
- **Audit Trail**: Complete history of all proposed and executed changes
- **Secure**: HMAC-SHA-384 authentication compatible with e-Financials API

## Screenshots

### Main Dashboard
Overview of company info, account balances, and all pending changes with their status.

![Main Dashboard](screenshot.png)

### Pending Changeset Review
Detailed view of journal entries awaiting approval, showing account codes, names, and debit/credit amounts.

![Pending Changeset](screenshot-changeset.png)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

```env
API_KEY_ID=your_api_key_id
API_KEY_PUBLIC=your_api_key_public
API_KEY_PASSWORD=your_api_key_password
API_BASE_URL=https://demo-rmp-api.rik.ee/v1
PORT=3000

# Optional hardening (see Security section)
# ALLOWED_ORIGINS=http://localhost:3000
# PROXY_AUTH_TOKEN=change-me
```

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY_ID` | Yes | e-Financials API key ID (used in the signed payload) |
| `API_KEY_PUBLIC` | Yes | e-Financials API public key (sent in `X-AUTH-KEY`) |
| `API_KEY_PASSWORD` | Yes | e-Financials API password (HMAC-SHA-384 signing key) |
| `API_BASE_URL` | No | Defaults to the demo environment `https://demo-rmp-api.rik.ee/v1` |
| `PORT` | No | Server port, defaults to `3000` |
| `DB_PATH` | No | SQLite database path; defaults to `pending_changes.db` in the project root (shared by the proxy and MCP servers) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS allowlist; defaults to `http://localhost:<PORT>` |
| `PROXY_AUTH_TOKEN` | No | When set, all write operations (proxy writes, approvals, rejections, deletes) require this token via `Authorization: Bearer <token>` or `X-Proxy-Token` header. The review UI picks it up from `?token=<token>` in the URL. |

### 3. Run

```bash
npm run dev
```

The server will start on port 3000 (or PORT env var).

**Access points:**
- Web UI: http://localhost:3000/review
- Health check: http://localhost:3000/health
- API connectivity test: http://localhost:3000/test-connection

## Documentation

- **[USAGE.md](USAGE.md)** - Complete usage guide for humans (installation, configuration, common tasks, troubleshooting)
- **[AGENTS.md](AGENTS.md)** - Instructions for AI assistants working with this project
- **[API Documentation](#api-endpoints)** - API reference below

## How It Works

### Architecture

```
AI Agent/Client → Proxy → [If GET] → e-Financials API
                       → [If WRITE] → SQLite Queue → Web UI → User Approval
                                                            ↓
                                                 [If Approved] → e-Financials API
```

### The Safety Model

1. **Read Operations** (`GET` requests): Pass through directly to the e-Financials API
2. **Write Operations** (`POST/PUT/PATCH/DELETE`): Captured in SQLite, queued for approval
3. **Human Review**: Use the web UI at `/review` to approve or reject changes
4. **Execution**: Only approved changes are sent to the actual e-Financials API

## Usage Examples

### For Humans (Web UI)

Open http://localhost:3000/review to:
- See all pending changes with journal entry visualization
- Approve or reject individual changes
- Approve or reject entire changesets
- Delete individual changesets or bulk-delete filtered changesets
- View executed changes and their results

### For AI Agents (MCP Server)

AI assistants use the MCP server to interact safely:

**Reading data:**
```
query_api with endpoint: "/accounts"
```

**Proposing changes:**
```
propose_change:
  endpoint: "/journals"
  method: "POST"
  body: {
    "no": "J-2024-001",
    "effective_date": "2024-01-15",
    "description": "Office supplies",
    "transactions": [
      {"debit_account": "5140", "credit_account": "1020", "amount": "125.50"}
    ]
  }
  description: "Record office supplies purchase"
```

**Checking status:**
```
list_pending_changes
```

See [AGENTS.md](AGENTS.md) for complete AI assistant guidelines.

## MCP Server Setup

### Using with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arveldaja": {
      "command": "node",
      "args": ["/full/path/to/arveldaja-proxy/dist/mcp-server.js"]
    }
  }
}
```

The server reads the API credentials from the `.env` file in the project root, so the MCP client config carries no secrets — agent hosts can read their own configuration, and an agent must never be able to see the credentials. Do not add the keys to an `env` block. (Real environment variables still take precedence over `.env` if you set them on the process some other way.)

### MCP Tools Available

**Reading:**
- `query_api` - Query any e-Financials endpoint

**Proposing:**
- `propose_change` - Propose changes (captured, not executed); pass `changesetId` to group related changes
- `create_changeset` - Create a changeset to group related proposals for a single review

**Checking:**
- `list_pending_changes` - See proposed changes; filter by `status` to see execution results or rejection reasons
- `list_changesets` - View all changesets
- `get_changeset_details` - Review a changeset including each change's outcome

## API Endpoints

### Proxy Endpoints

- `GET /proxy/v1/*` - Forward read requests to e-Financials
- `POST/PATCH/PUT/DELETE /proxy/v1/*` - Capture write requests

Captured writes get an auto-created single-change changeset. To group several writes together, first create a changeset via `POST /api/changesets` and pass its ID in an `X-Changeset-Id` header on each write.

Example:
```bash
# Read accounts (passes through)
curl http://localhost:3000/proxy/v1/accounts

# Create journal (captured)
curl -X POST http://localhost:3000/proxy/v1/journals \
  -H "Content-Type: application/json" \
  -d '{
    "no": "J-001",
    "effective_date": "2024-01-15",
    "description": "Test entry",
    "transactions": [
      {"debit_account": "5140", "credit_account": "1020", "amount": "100.00"}
    ]
  }'
```

### Management API

- `GET /api/changes` - List all changes (optional `?status=pending|approved|rejected`)
- `GET /api/changes/:id` - Get specific change
- `POST /api/changes/:id/approve` - Approve and execute
- `POST /api/changes/:id/reject` - Reject change
- `DELETE /api/changes/:id` - Delete a change
- `GET /api/changesets` - List changesets (optional `?status=pending|approved|rejected`)
- `GET /api/changesets/:id` - Get changeset with changes
- `POST /api/changesets` - Create a changeset (body: `{name, description?}`)
- `POST /api/changesets/:id/approve` - Approve and execute all in changeset
- `POST /api/changesets/:id/reject` - Reject all in changeset
- `POST /api/changesets/:id/changes` - Move changes into a changeset (body: `{changeIds: [...]}`)
- `DELETE /api/changesets/:id` - Delete one changeset and its captured changes
- `DELETE /api/changesets` - Delete all changesets (optional `?status=pending|approved|rejected`)
- `GET /api/stats` - Get statistics

### Reporting API

Aggregated views computed by the proxy from e-Financials data (used by the web UI):

- `GET /api/company` - Company info (VAT registration, invoice settings, bank accounts)
- `GET /api/accounts` - Chart of accounts
- `GET /api/account-balances?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` - Opening/closing balances and period changes per account (optional `&accounts=1020,5140` and `&includeDimensions=true`)
- `GET /api/account-dimensions?account=1750` - Dimension usage statistics for an account

### Journal payload behavior

- For `/journals` writes, the proxy converts simplified `transactions` to API `postings`.
- If a journal payload contains `description` but no `title`, the proxy automatically sets `title = description` so the journal description is visible in e-Financials.

### UI Routes

- `GET /review` and `GET /review/:id` - Review interface
- `GET /health` - Health check
- `GET /test-connection` - Verify e-Financials API credentials and connectivity

## Scripts

```bash
npm run build      # Compile TypeScript
npm run dev        # Run with hot reload
npm start          # Run production build
npm run mcp        # Run MCP server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript check
```

## Project Structure

```
public/
└── index.html            # Review web UI (single page)
src/
├── index.ts              # Main Express server (CORS, auth guard, proxy routes)
├── mcp-server.ts         # MCP server for AI agents
├── db/
│   └── index.ts          # SQLite database operations
├── middleware/
│   └── capture.ts        # Request interception middleware
├── routes/
│   ├── api.ts            # Change management API
│   ├── changesets.ts     # Changeset management API
│   └── company.ts        # Company info and balance aggregation
├── types/
│   └── index.ts          # Shared TypeScript types
└── utils/
    ├── auth.ts           # HMAC-SHA-384 signing
    ├── executor.ts       # Forward reads, execute approved changes
    └── locks.ts          # In-process locks against double approval
```

## Security

- **API Credentials**: Loaded from the project root `.env` by the node processes themselves — never placed in MCP client configs or other agent-readable locations
- **Approval Required**: All writes require explicit human approval
- **Audit Trail**: Complete history stored in SQLite
- **No Secrets Logged**: Credentials never appear in logs
- **CORS Allowlist**: Browser origins are restricted to `ALLOWED_ORIGINS` (default: the local review UI) so arbitrary websites cannot issue write/approval requests
- **Optional Write Token**: Set `PROXY_AUTH_TOKEN` to require a shared secret on all mutating requests, including approvals
- **Host Pinning**: Forwarded requests are rejected unless they resolve to the configured API origin, so signed auth headers can't leak to other hosts
- **Double-Approval Protection**: In-process locks prevent concurrent approvals from executing the same change twice

## License

MIT License - see LICENSE file for details.

## Support

- **Documentation**: See [USAGE.md](USAGE.md) and [AGENTS.md](AGENTS.md)
- **Issues**: https://github.com/v3rm0n/arveldaja-proxy/issues
