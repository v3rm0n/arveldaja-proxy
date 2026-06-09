#!/usr/bin/env node
/**
 * Standalone stdio entry point for the arveldaja-proxy MCP server.
 *
 * The same server is also exposed over Streamable HTTP at /mcp by the main
 * Express server (src/index.ts) — prefer that when the proxy is running, as
 * it shares one process and one database handle. This entry point remains for
 * MCP clients that only support stdio servers.
 */

import './utils/env';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initDatabase } from './db';
import { createMcpServer } from './mcp/server';

async function main() {
  await initDatabase();
  console.error('Database initialized');

  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
