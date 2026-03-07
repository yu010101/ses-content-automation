const MCP_URL = "http://127.0.0.1:3002/mcp";

let sessionId: string | null = null;

export async function mcpInit(): Promise<string> {
  if (sessionId) return sessionId;

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ses-content-automation", version: "1.0.0" },
      },
    }),
  });

  const sid = res.headers.get("mcp-session-id");
  if (!sid) throw new Error("No MCP session ID returned");
  sessionId = sid;
  return sid;
}

export async function mcpCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const sid = await mcpInit();

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "mcp-session-id": sid,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const text = await res.text();
  // MCP SSE response: parse the last "data:" line
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  if (lines.length === 0) throw new Error(`MCP empty response for ${toolName}`);

  const lastData = lines[lines.length - 1].replace("data: ", "");
  const parsed = JSON.parse(lastData);

  if (parsed.error) {
    throw new Error(`MCP ${toolName} error: ${JSON.stringify(parsed.error)}`);
  }

  return parsed.result;
}

export async function isMcpAvailable(): Promise<boolean> {
  try {
    await mcpInit();
    return true;
  } catch {
    return false;
  }
}
