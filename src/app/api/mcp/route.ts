import { NextResponse } from "next/server";
import { resolveMcpCaller } from "@/lib/mcp/identity";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME, McpToolError } from "@/lib/mcp/tools";
import { verifySlackSignature } from "@/lib/slack/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stateless MCP server (Streamable HTTP, JSON responses) for Slackbot.
 * Every request must carry a valid Slack signature; tool calls act as the Slack user in `_meta.slack`.
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "case-tracker", title: "Ramos James Case Tracker", version: "1.0.0" };
const SERVER_INSTRUCTIONS =
  "Case Tracker for Ramos James Law: live case status from DocketFlow and the case tracker. Users only see and edit cases they have access to on the website. Before any write tool, restate the exact change and get the user's confirmation.";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown> & { _meta?: { slack?: { user_id?: string; team_id?: string } } };
};

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolText(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function callTool(request: JsonRpcRequest) {
  const params = request.params ?? {};
  const name = typeof params.name === "string" ? params.name : "";
  const tool = MCP_TOOLS_BY_NAME.get(name);
  if (!tool) return toolText(`Unknown tool "${name}".`, true);

  const slackUserId = params._meta?.slack?.user_id;
  if (!slackUserId) return toolText("Missing Slack identity. This tool must be called from Slackbot.", true);

  const caller = await resolveMcpCaller(slackUserId);
  if (!caller) {
    return toolText(
      "Your Slack account isn't linked to a @ramosjames.com Case Tracker user, so Case Tracker can't show or change cases for you.",
      true,
    );
  }

  const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
  try {
    return toolText(await tool.handler(args, caller));
  } catch (error) {
    if (error instanceof McpToolError) return toolText(error.message, true);
    console.error("MCP tool failed", { tool: name, slackUserId, error });
    return toolText(`Case Tracker couldn't complete ${name}: ${error instanceof Error ? error.message : "unknown error"}.`, true);
  }
}

async function handleMessage(message: JsonRpcRequest) {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  switch (message.method) {
    case "initialize": {
      const requested = typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "";
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { title, ...annotations },
        })),
      });
    case "tools/call":
      return rpcResult(id, await callTool(message));
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${message.method ?? "(none)"}`);
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
    )
  ) {
    return NextResponse.json(rpcError(null, -32600, "Invalid Slack signature."), { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error."), { status: 400 });
  }

  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as JsonRpcRequest[];
  const responses = (await Promise.all(messages.map(handleMessage))).filter((item) => item !== null);

  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(parsed) ? responses : responses[0]);
}

export async function GET() {
  return NextResponse.json(rpcError(null, -32000, "Use POST for MCP requests."), {
    status: 405,
    headers: { Allow: "POST" },
  });
}
