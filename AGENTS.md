# AGENTS.md - Instructions for AI Assistants

> **This file is for you, the AI assistant.** It contains context and guidelines for working with the arveldaja-proxy project.

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
  data: {
    "no": "J-2024-001",
    "effective_date": "2024-01-15",
    "description": "Office supplies purchase",
    "transactions": [
      {"debit_account": "5140", "credit_account": "1020", "amount": "125.50"}
    ]
  }
  description: "Record office supplies expense"
```

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

### 3. list_pending_changes - Check Status

See what changes are currently awaiting human approval.

### 4. list_changesets / get_changeset_details - Review Groupings

Changesets group related changes together. Use these to see the overall state.

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

## Environment

The project connects to the **demo environment**:
- Base URL: `https://demo-rmp-api.rik.ee/v1`
- Authentication: HMAC-SHA-384 signing
- Database: SQLite (`pending_changes.db`)

## File Structure

```
src/
├── index.ts              # Main Express server
├── mcp-server.ts         # MCP server for AI agents
├── db/
│   └── index.ts          # Database operations
├── middleware/
│   └── capture.ts        # Request interception
├── routes/
│   ├── api.ts            # Change management API
│   ├── changesets.ts     # Changeset management API
│   └── company.ts        # Company info aggregation
└── utils/
    ├── auth.ts           # HMAC-SHA-384 signing
    └── executor.ts       # Execute approved changes
```

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

- API credentials are stored in environment variables, never expose them
- The database contains financial data - handle with care
- All actions are logged for audit purposes
- Never suggest disabling the approval system
