import { describe, expect, it } from "vitest";
import { handleBody, handleMessage, METHOD_NOT_FOUND, negotiate, type Server } from "./protocol";

const server: Server = {
  name: "test",
  title: "Test",
  version: "1.0.0",
  instructions: () => "Be nice.",
  tools: [
    {
      name: "echo",
      title: "Echo",
      description: "Says it back",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      annotations: { readOnlyHint: true },
      run: async (args) => ({ text: String(args.text ?? "") }),
    },
    {
      name: "broken",
      title: "Broken",
      description: "Throws",
      inputSchema: { type: "object" },
      annotations: {},
      run: async () => {
        throw new Error("It broke.");
      },
    },
  ],
};

describe("MCP messages", () => {
  it("initialize speaks the client's version when it can, else the newest", async () => {
    expect(negotiate("2025-06-18")).toBe("2025-06-18");
    expect(negotiate("1999-01-01")).toBe("2025-11-25");
    const r = await handleMessage(server, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "grok" } } });
    expect(r).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "test", title: "Test", version: "1.0.0" }, instructions: "Be nice." },
    });
  });
  it("notifications and responses get no answer", async () => {
    expect(await handleMessage(server, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleMessage(server, { jsonrpc: "2.0", id: 5, result: {} })).toBeNull();
  });
  it("lists the tools without their code", async () => {
    const r = await handleMessage(server, { jsonrpc: "2.0", id: "a", method: "tools/list" });
    const tools = (r?.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(["echo", "broken"]);
    expect(tools[0]).not.toHaveProperty("run");
    expect(tools[0].annotations).toEqual({ title: "Echo", readOnlyHint: true });
  });
  it("calls a tool; a tool that throws tells the model, not the protocol", async () => {
    expect(await handleMessage(server, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } })).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "hi" }], isError: false },
    });
    expect(await handleMessage(server, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "broken" } })).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "It broke." }], isError: true },
    });
    expect((await handleMessage(server, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }))?.error?.code).toBe(-32602);
  });
  it("unknown methods and junk", async () => {
    expect((await handleMessage(server, { jsonrpc: "2.0", id: 6, method: "sampling/createMessage" }))?.error?.code).toBe(METHOD_NOT_FOUND);
    expect((await handleMessage(server, { id: 7, method: "ping" }))?.error?.code).toBe(-32600);
    expect(await handleMessage(server, { jsonrpc: "2.0", id: 8, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 8, result: {} });
  });
  it("a batch answers its requests only", async () => {
    const r = await handleBody(server, [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ]);
    expect(r).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(await handleBody(server, [{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeNull();
  });
});
