# Usage Guide for arveldaja-proxy

Complete guide for using the e-arveldaja proxy system.

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Running the Server](#running-the-server)
4. [Web Interface](#web-interface)
5. [AI Agent Integration](#ai-agent-integration)
6. [API Reference](#api-reference)
7. [Common Tasks](#common-tasks)
8. [Troubleshooting](#troubleshooting)

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- e-Financials API credentials

### Install Dependencies

```bash
npm install
```

### Build the Project

```bash
npm run build
```

## Configuration

Create a `.env` file in the project root:

```env
# e-Financials API Credentials
API_KEY_ID=your_api_key_id
API_KEY_PUBLIC=your_api_key_public
API_KEY_PASSWORD=your_api_key_password

# API Configuration
API_BASE_URL=https://demo-rmp-api.rik.ee/v1
PORT=3000
```

### Getting API Credentials

1. Log in to your e-Financials account
2. Navigate to Settings → API Access
3. Generate new API credentials
4. Copy the Key ID, Public Key, and Password to your `.env` file

## Running the Server

### Development Mode

```bash
npm run dev
```

This starts the server with hot reload. Access the web UI at:
- Web Interface: http://localhost:3000/review
- Health Check: http://localhost:3000/health

### Production Mode

```bash
npm run build
npm start
```

### Running the MCP Server

For AI agent integration:

```bash
npm run mcp
```

## Web Interface

### Dashboard Overview

The web interface at `http://localhost:3000/review` provides:

- **Company Info Card**: VAT registration, invoice settings, bank accounts
- **Statistics**: Counts of pending, approved, and rejected changes
- **Changeset List**: All changesets with expand/collapse for details
- **Journal Entry Visualization**: Double-entry format with debit/credit columns
- **Action Buttons**: Approve/reject individual changes or entire changesets

### Reviewing Changes

1. **Expand a Changeset**: Click the arrow to see all changes within
2. **Review Journal Entries**: See account codes, names, and amounts
3. **View API Request**: For pending changes, see the exact API call that will be made
4. **View API Response**: For approved changes, see the result from e-Financials
5. **Approve/Reject**: Use buttons to approve individual changes or entire changesets

### Understanding Statuses

- **Pending**: Changes awaiting your approval
- **Approved**: Changes that have been executed successfully
- **Rejected**: Changes that were declined or failed execution

## AI Agent Integration

### Overview

AI agents can interact with the system through the MCP server. Agents have:

- **Read Access**: Full access to query accounts, journals, transactions, etc.
- **Propose Access**: Can propose changes that are captured for your approval
- **No Execute Access**: Cannot directly modify the system

### Available MCP Tools

**Reading Data:**
- `query_api` - Query any e-Financials endpoint

**Proposing Changes:**
- `propose_change` - Submit changes for approval (captured, not executed)

**Checking Status:**
- `list_pending_changes` - See awaiting changes
- `list_changesets` - View all changesets
- `get_changeset_details` - Review specific changeset

### Configuring Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arveldaja": {
      "command": "node",
      "args": ["/full/path/to/arveldaja-proxy/dist/mcp-server.js"],
      "env": {
        "API_KEY_ID": "your_api_key_id",
        "API_KEY_PUBLIC": "your_api_key_public",
        "API_KEY_PASSWORD": "your_api_key_password"
      }
    }
  }
}
```

### Working with AI Agents

**Good prompts:**
- "Show me all expense accounts"
- "What was our revenue last month?"
- "Create a journal entry for this month's rent"
- "Check if my proposed changes have been approved"

**The AI will:**
1. Query data to understand the current state
2. Explain what change it wants to make
3. Propose the change for your approval
4. Guide you to the web UI for review

## API Reference

### Proxy Endpoints

All proxy endpoints are prefixed with `/proxy/v1/`.

**Reading (passes through to e-Financials):**

```bash
# Get all accounts
curl http://localhost:3000/proxy/v1/accounts

# Get specific journal
curl http://localhost:3000/proxy/v1/journals/123

# Get VAT info
curl http://localhost:3000/proxy/v1/vat_info
```

**Writing (captured for approval):**

```bash
# Create journal entry
curl -X POST http://localhost:3000/proxy/v1/journals \
  -H "Content-Type: application/json" \
  -d '{
    "no": "J-2024-001",
    "effective_date": "2024-01-15",
    "description": "Office supplies",
    "transactions": [
      {"debit_account": "5140", "credit_account": "1020", "amount": "100.00"}
    ]
  }'

# Update journal
curl -X PUT http://localhost:3000/proxy/v1/journals/123 \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}'

# Delete journal
curl -X DELETE http://localhost:3000/proxy/v1/journals/123
```

### Management API

These endpoints manage the pending changes queue:

```bash
# List all changes
curl http://localhost:3000/api/changes

# Get specific change
curl http://localhost:3000/api/changes/:id

# Approve a change
curl -X POST http://localhost:3000/api/changes/:id/approve

# Reject a change
curl -X POST http://localhost:3000/api/changes/:id/reject

# List changesets
curl http://localhost:3000/api/changesets

# Get changeset with changes
curl http://localhost:3000/api/changesets/:id

# Approve all changes in a changeset
curl -X POST http://localhost:3000/api/changesets/:id/approve

# Reject all changes in a changeset
curl -X POST http://localhost:3000/api/changesets/:id/reject

# Get statistics
curl http://localhost:3000/api/stats
```

## Common Tasks

### Recording an Expense

**Via Web UI:**
1. Create a POST request to `/proxy/v1/journals` with expense details
2. Go to `http://localhost:3000/review`
3. Find the pending changeset
4. Review the journal entry details
5. Click "Approve"

**Via AI Agent:**
1. Ask the AI: "Record a €50 office supplies expense from bank account"
2. The AI will query accounts, then propose the change
3. Review at `http://localhost:3000/review`
4. Approve when ready

### Month-End Closing

1. Group all closing entries in a changeset:
   ```bash
   curl -X POST http://localhost:3000/api/changesets \
     -H "Content-Type: application/json" \
     -d '{"name": "Month-end Closing Jan 2024", "description": "Close revenue and expense accounts"}'
   ```

2. Propose all closing journal entries
3. Review the entire changeset in the web UI
4. Approve all at once with "Approve All Changes"

### Correcting a Mistake

1. First reject the incorrect change
2. Propose the correct entry
3. Review and approve the correction

### Checking Account Balances

```bash
# Via proxy (query passes through)
curl http://localhost:3000/proxy/v1/accounts

# Or ask AI: "What's the balance of account 1020?"
```

## Troubleshooting

### Server Won't Start

**Problem:** Port 3000 is already in use
**Solution:** Change `PORT` in `.env` or kill the process using port 3000

**Problem:** Database error
**Solution:** Check that `pending_changes.db` is writable

### Changes Not Executing

**Problem:** API credentials invalid
**Solution:** Verify `API_KEY_ID`, `API_KEY_PUBLIC`, and `API_KEY_PASSWORD` in `.env`

**Problem:** Network error
**Solution:** Check that you can reach `https://demo-rmp-api.rik.ee/v1`

### Approval Failed

**Problem:** "Change is already approved/rejected"
**Solution:** The change was already processed. Check the status in the web UI.

**Problem:** API error when executing
**Solution:** Check the error message in the web UI. Common issues:
- Invalid account codes
- Duplicate journal numbers
- Invalid dates

### MCP Server Issues

**Problem:** "Command not found" in Claude Desktop
**Solution:** Use the full absolute path to `dist/mcp-server.js`

**Problem:** "Environment variables not set"
**Solution:** Add env vars to the MCP config in Claude Desktop settings

## Security Best Practices

1. **Keep credentials secure**: Never commit `.env` file
2. **Review carefully**: Always review AI-proposed changes before approving
3. **Regular backups**: Backup `pending_changes.db` regularly
4. **Limit access**: Restrict who can access the web UI
5. **Audit trail**: All actions are logged - review the logs periodically

## Getting Help

- **GitHub Issues**: https://github.com/yourusername/arveldaja-proxy/issues
- **Documentation**: See README.md and AGENTS.md
- **e-Financials API Docs**: https://demo-rmp-api.rik.ee/docs
