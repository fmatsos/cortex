import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import type { Mode } from "./backends/backend";
import { callTool, toolPack, zodShape } from "./backends/tools";
import pkg from "../package.json";

/**
 * MCP server of the cortex tool pack, for the agent cortex runs (compile, ask): the same tools, guard and checks as
 * the openai backend, over stdio. Not the `cortex mcp` server of a human's agent (search, get, add…): read mode lists
 * no writing tool.
 */
export function buildAgentServer(root: string, mode: Mode): McpServer {
  const s = new McpServer({ name: "cortex", version: pkg.version });
  for (const t of toolPack(mode))
    s.registerTool(t.name, { description: t.description, inputSchema: z.object(zodShape(t)) },
      async (args: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: await callTool(root, mode, t.name, args) }] }));
  return s;
}

export async function serveAgentMcp(root: string, mode: Mode) {
  console.log = console.error; // stdout is the protocol
  serveStdio(() => buildAgentServer(root, mode));
}
