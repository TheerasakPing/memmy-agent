import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "memmy-r8-stdio-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "r8_echo",
    description: "Echo a short R8 QA string",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  }]
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
  content: [{ type: "text", text: "R8 MCP " + String(params.arguments?.text ?? "") }]
}));
await server.connect(new StdioServerTransport());
