import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TOOLS } from './tools.ts'

declare const VERSION: string

if (process.argv[2] === '--tools') {
  process.stdout.write(JSON.stringify([...TOOLS.keys()]))
  process.exit(0)
}

const server = new McpServer(
  { name: 'ccwt-mcp-server', version: VERSION },
  { capabilities: { tools: {} } },
)

for (const [name, config, handler] of TOOLS.values()) server.registerTool(name, config as never, handler as never)

await server.connect(new StdioServerTransport())
