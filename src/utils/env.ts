import dotenv from 'dotenv';
import path from 'path';

// Load credentials from the project root .env regardless of the launch cwd.
// MCP client configs (e.g. claude_desktop_config.json) must not carry the API
// secrets in their env blocks — the agent host can read its own config, while
// only this node process should ever see the credentials. Real environment
// variables still take precedence: dotenv never overrides existing values.
// Both src/utils (tsx) and dist/utils (compiled) are two levels below root.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
