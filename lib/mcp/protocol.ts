// The Model Context Protocol's messages, for /api/mcp: JSON-RPC 2.0 over
// plain HTTP POSTs ("Streamable HTTP", answered as JSON, no sessions). Enough
// for any MCP client (Grok's connectors, Claude, ChatGPT) to list the tools
// and call them. Pure: the tools come in from lib/social/mcp/tools.ts.

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_VERSION = SUPPORTED_VERSIONS[0];

export type JsonSchema = Record<string, unknown>;

export type ToolResult = { text: string; isError?: boolean };

export type Tool<Args = Record<string, unknown>> = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Args) => Promise<ToolResult>;
};

export type Server = {
  name: string;
  title: string;
  version: string;
  instructions: () => Promise<string> | string;
  tools: Tool[];
};

type Id = string | number | null;
export type RpcRequest = { jsonrpc: "2.0"; id?: Id; method: string; params?: Record<string, unknown> };
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export function rpcError(id: Id, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRequest(m: unknown): m is RpcRequest {
  return !!m && typeof m === "object" && (m as RpcRequest).jsonrpc === "2.0" && typeof (m as RpcRequest).method === "string";
}

// The version both sides speak: the client's if it's one of ours, else our newest.
export function negotiate(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_VERSION;
}

// One message in, its answer out (null for a notification, which gets none).
export async function handleMessage(server: Server, message: unknown): Promise<RpcResponse | null> {
  if (!isRequest(message)) {
    // a response to something we never asked, or junk with an id
    const id = message && typeof message === "object" && "id" in message ? ((message as { id: Id }).id ?? null) : null;
    const isResponse = !!message && typeof message === "object" && ("result" in message || "error" in message);
    return isResponse ? null : rpcError(id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.");
  }
  const notification = message.id === undefined;
  if (notification) return null;
  const id = message.id ?? null;
  const params = message.params ?? {};
  try {
    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: negotiate(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: server.name, title: server.title, version: server.version },
            instructions: await server.instructions(),
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: server.tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })) },
        };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const tool = server.tools.find((t) => t.name === name);
        if (!tool) return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name || "(none)"}`);
        const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
        let result: ToolResult;
        try {
          result = await tool.run(args);
        } catch (e) {
          // a tool that broke says so to the model, which can tell the person
          result = { text: e instanceof Error ? e.message : "Something went wrong.", isError: true };
        }
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: result.text }], isError: !!result.isError } };
      }
      // the lists a client may ask for even though they aren't offered
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };
      case "resources/templates/list":
        return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };
      case "logging/setLevel":
        return { jsonrpc: "2.0", id, result: {} };
      default:
        return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  } catch (e) {
    return rpcError(id, INTERNAL_ERROR, e instanceof Error ? e.message : "Internal error");
  }
}

// A POST's body: one message or (older clients) a batch.
export async function handleBody(server: Server, body: unknown): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (!body.length) return rpcError(null, INVALID_REQUEST, "Empty batch.");
    const answers = (await Promise.all(body.map((m) => handleMessage(server, m)))).filter((a): a is RpcResponse => a !== null);
    return answers.length ? answers : null;
  }
  return handleMessage(server, body);
}
