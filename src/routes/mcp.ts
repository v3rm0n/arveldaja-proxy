import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server';

const router = Router();

const PORT = process.env.PORT || 3000;

// Hosts an MCP client may use to reach this endpoint. The transport rejects
// other Host headers (DNS rebinding protection): a malicious website rebound
// to 127.0.0.1 would otherwise reach the endpoint with no Origin header,
// bypassing the CORS allowlist. Override when serving on a non-local host.
const allowedHosts = (
  process.env.MCP_ALLOWED_HOSTS ||
  `localhost,localhost:${PORT},127.0.0.1,127.0.0.1:${PORT}`
)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

// Stateless Streamable HTTP: a fresh server + transport per request, no
// session bookkeeping. Fine here because the server only exposes tools — no
// subscriptions or server-initiated notifications that would need a session.
router.post('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Without sessions there is no SSE notification stream to GET and no session
// to DELETE; tell spec-compliant clients these are unsupported.
router.all('/mcp', (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

export default router;
