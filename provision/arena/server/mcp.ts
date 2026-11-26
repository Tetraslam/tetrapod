export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>) => Promise<unknown>;
};

export function createMcpHandler(tools: McpToolDef[], serverName = "mindustry-arena", version = "1.0.0") {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const sessions = new Set<string>();

  return async function handleMcp(req: Request): Promise<Response> {
    if (req.method === "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (req.method === "DELETE") {
      const sid = req.headers.get("mcp-session-id");
      if (sid) sessions.delete(sid);
      return new Response(null, { status: 204 });
    }
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let msg: any;
    try {
      msg = await req.json();
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        { status: 400 }
      );
    }

    const id = msg?.id ?? null;
    const method = String(msg?.method || "");
    const params = msg?.params || {};

    // Notifications (no id) get 202 Accepted
    if (id === null && method.startsWith("notifications/")) {
      return new Response(null, { status: 202 });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "no-cache",
    };

    if (method === "initialize") {
      const sid = crypto.randomUUID();
      sessions.add(sid);
      headers["mcp-session-id"] = sid;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: serverName, version },
          },
        }),
        { status: 200, headers }
      );
    }

    if (method === "ping") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: {} }), { status: 200, headers });
    }

    if (method === "tools/list") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        }),
        { status: 200, headers }
      );
    }

    if (method === "tools/call") {
      const name = String(params?.name || "");
      const tool = byName.get(name);
      if (!tool) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `Unknown tool: ${name}` },
          }),
          { status: 200, headers }
        );
      }
      try {
        const result = await tool.handler((params?.arguments as Record<string, any>) || {});
        const content =
          result && typeof result === "object" && Array.isArray((result as any)._mcpContent)
            ? (result as any)._mcpContent
            : [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }];
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content },
          }),
          { status: 200, headers }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [{ type: "text", text: String(err?.message || err) }],
            },
          }),
          { status: 200, headers }
        );
      }
    }

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }),
      { status: 200, headers }
    );
  };
}
