import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import { record, type RpcNotification } from "./app-server.js";

/** Convert structured App Server items into the existing bounded preview format. */
export function previewEvent(notification: RpcNotification, text: Map<string, string>): ThreadEvent | null {
  const { method, params } = notification;
  const id = String(params.itemId ?? record(params.item).id ?? "");
  if (method === "item/agentMessage/delta") {
    const value = (text.get(id) ?? "") + String(params.delta ?? "");
    text.set(id, value);
    return { type: "item.updated", item: { id, type: "agent_message", text: value } };
  }
  if (method === "item/commandExecution/outputDelta") {
    // Keep a bounded tail; complete command items provide their own final output.
    const value = ((text.get(id) ?? "") + String(params.delta ?? "")).slice(-1000);
    text.set(id, value);
    return { type: "item.updated", item: { id, type: "command_execution", command: "Tool command", aggregated_output: value, status: "in_progress" } };
  }
  if (method === "turn/plan/updated") {
    return { type: "item.updated", item: { id: "plan", type: "todo_list", items: Array.isArray(params.plan) ? params.plan.map((step) => ({ text: String(record(step).step ?? ""), completed: record(step).status === "completed" })) : [] } };
  }
  if (method !== "item/started" && method !== "item/completed") return null;
  const raw = record(params.item);
  let item: ThreadItem;
  const completed = method === "item/completed";
  switch (raw.type) {
    case "agentMessage": {
      const value = String(raw.text ?? text.get(id) ?? "");
      text.set(id, value);
      item = { id, type: "agent_message", text: value };
      break;
    }
    case "commandExecution":
      item = { id, type: "command_execution", command: String(raw.command ?? ""), aggregated_output: String(raw.aggregatedOutput ?? "").slice(-1000), status: completed ? (raw.status === "completed" ? "completed" : "failed") : "in_progress", ...(typeof raw.exitCode === "number" ? { exit_code: raw.exitCode } : {}) };
      break;
    case "fileChange":
      item = { id, type: "file_change", status: raw.status === "failed" ? "failed" : "completed", changes: Array.isArray(raw.changes) ? raw.changes.map((change) => {
        const value = record(change);
        const kind = record(value.kind).type;
        return { path: String(value.path ?? ""), kind: kind === "add" || kind === "delete" ? kind : "update" };
      }) : [] };
      break;
    case "mcpToolCall":
      item = { id, type: "mcp_tool_call", server: String(raw.server ?? ""), tool: String(raw.tool ?? ""), arguments: raw.arguments, status: completed ? (raw.status === "failed" ? "failed" : "completed") : "in_progress" };
      break;
    case "webSearch":
      item = { id, type: "web_search", query: String(raw.query ?? record(raw.action).query ?? "Web search") };
      break;
    case "reasoning":
      // Activity only. Do not expose reasoning content or summaries.
      item = { id, type: "reasoning", text: "" };
      break;
    default: return null;
  }
  return { type: completed ? "item.completed" : "item.started", item };
}
