# e-arveldaja Proxy

A safety layer proxy for Estonian e-Financials API that allows AI agents to freely read bookkeeping data while capturing all write operations for human approval.

## Features

- **Read-Only by Default**: AI agents can freely query all data (accounts, journals, transactions, invoices)
- **Write Protection**: All POST/PATCH/PUT/DELETE operations are captured and queued for approval
- **Beautiful UI**: Web interface with specialized visualization for double-entry bookkeeping
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

Create a `.env` file:

```env
API_KEY_ID=your_api_key_id
API_KEY_PUBLIC=your_api_key_public
API_KEY_PASSWORD=your_api_key_password
API_BASE_URL=https://demo-rmp-api.rik.ee/v1
PORT=3000
```

### 3. Run the server

```bash
npm run dev
```

The server will start on port 3000 (or PORT env var).

## Usage

### For AI Agents (Reading)

AI agents can read data freely through the proxy:

```bash
curl http://localhost:3000/proxy/v1/accounts \
  -H "X-AUTH-QUERYTIME: 2024-01-15T10:30:00" \
  -H "X-AUTH-KEY: your_key:signature"
```

### For AI Agents (Writing)

When an agent tries to write, the change is captured:

```bash
curl -X POST http://localhost:3000/proxy/v1/journals \
  -H "Content-Type: application/json" \
  -H "X-AUTH-QUERYTIME: 2024-01-15T10:30:00" \
  -H "X-AUTH-KEY: your_key:signature" \
  -d '{
    "no": "J-2024-001",
    "effective_date": "2024-01-15",
    "description": "Monthly accruals",
    "transactions": [
      {"debit_account": "6000", "credit_account": "2030", "amount": "1000.00"}
    ]
  }'
```

Response:
```json
{
  "success": true,
  "message": "Change captured and pending approval",
  "changeId": "uuid-here",
  "status": "pending",
  "reviewUrl": "/review/uuid-here"
}
```

### For Humans (Review)

Open http://localhost:3000/review to see all pending changes with beautiful visualization of:
- Journal entries with debit/credit lines
- Before/after diffs for updates
- Full JSON for complex operations

Approve or reject changes with one click.

## API Endpoints

### Proxy Endpoints
- `GET /proxy/v1/*` - Forward read requests to e-Financials
- `POST/PATCH/PUT/DELETE /proxy/v1/*` - Capture write requests

### Management API
- `GET /api/changes` - List all changes
- `GET /api/changes/:id` - Get specific change
- `POST /api/changes/:id/approve` - Approve and execute
- `POST /api/changes/:id/reject` - Reject change
- `DELETE /api/changes/:id` - Delete change
- `GET /api/stats` - Get statistics

### UI
- `GET /review` - Review interface
- `GET /health` - Health check

## Architecture

```
AI Agent → Proxy → [If GET] → e-Financials API
                → [If WRITE] → SQLite Queue → Web UI → User Approval
                                                         ↓
                                              [If Approved] → e-Financials API
```

## Security

- All API credentials stay in the proxy
- Changes never execute without explicit approval
- Complete audit trail stored in SQLite
- No secrets logged or exposed

## License

MIT
