import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";

export type StreamMode = "off" | "brief" | "verbose";

export interface StreamState {
  agentText: string;
  activity: string;
  plan: Array<{ text: string; completed: boolean }>;
  verboseTail: string;
  lastAgentItemText: string;
}

const PREVIEW_LIMIT = 3800;
const VERBOSE_TAIL_LIMIT = 1000;

export function createStreamState(): StreamState {
  return {
    agentText: "",
    activity: "Codex is starting…",
    plan: [],
    verboseTail: "",
    lastAgentItemText: "",
  };
}

export function applyStreamEvent(state: StreamState, event: ThreadEvent): void {
  if (event.type === "turn.started") {
    state.activity = "Codex is working…";
    return;
  }
  if (event.type === "turn.completed") {
    state.activity = "Finalizing the response…";
    return;
  }
  if (event.type === "turn.failed") {
    state.activity = `Failed: ${singleLine(event.error.message, 180)}`;
    return;
  }
  if (event.type === "error") {
    state.activity = `Error: ${singleLine(event.message, 180)}`;
    return;
  }
  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
    return;
  }

  const completed = event.type === "item.completed";
  applyItem(state, event.item, completed);
}

export function renderStreamPreview(state: StreamState, mode: StreamMode): string {
  if (mode === "off") return "";

  const sections: string[] = [];
  if (state.agentText.trim()) sections.push(state.agentText.trim());
  sections.push(`⏳ ${state.activity}`);

  if (state.plan.length > 0) {
    const complete = state.plan.filter((item) => item.completed).length;
    if (mode === "brief") {
      sections.push(`📋 Plan: ${complete}/${state.plan.length} complete`);
    } else {
      sections.push(state.plan.map((item) => `${item.completed ? "☑" : "☐"} ${item.text}`).join("\n"));
    }
  }

  if (mode === "verbose" && state.verboseTail.trim()) {
    sections.push(`Latest tool output:\n${state.verboseTail.trim()}`);
  }

  return truncatePreview(sections.join("\n\n"), PREVIEW_LIMIT);
}

function applyItem(state: StreamState, item: ThreadItem, completed: boolean): void {
  switch (item.type) {
    case "agent_message": {
      const delta = textDelta(state.lastAgentItemText, item.text);
      if (delta) state.agentText += delta;
      state.lastAgentItemText = item.text;
      state.activity = completed ? "Preparing the final answer…" : "Writing a response…";
      break;
    }
    case "reasoning":
      state.activity = completed ? "Reasoning step completed." : "Reasoning…";
      break;
    case "command_execution": {
      const command = singleLine(item.command, 140);
      state.activity = completed
        ? `${item.status === "failed" ? "Command failed" : "Command completed"}: ${command}`
        : `Running: ${command}`;
      if (item.aggregated_output) state.verboseTail = tail(item.aggregated_output, VERBOSE_TAIL_LIMIT);
      break;
    }
    case "file_change": {
      const count = item.changes.length;
      state.activity = `${completed ? "Updated" : "Updating"} ${count} file${count === 1 ? "" : "s"}.`;
      state.verboseTail = item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n");
      break;
    }
    case "web_search":
      state.activity = `${completed ? "Searched" : "Searching"}: ${singleLine(item.query, 140)}`;
      break;
    case "mcp_tool_call":
      state.activity = completed
        ? `${item.status === "failed" ? "Tool failed" : "Tool completed"}: ${item.server}/${item.tool}`
        : `Calling tool: ${item.server}/${item.tool}`;
      if (item.error?.message) state.verboseTail = tail(item.error.message, VERBOSE_TAIL_LIMIT);
      break;
    case "todo_list":
      state.plan = item.items.map((entry) => ({ ...entry }));
      state.activity = "Following the task plan…";
      break;
    case "error":
      state.activity = `Error: ${singleLine(item.message, 180)}`;
      break;
  }
}

function textDelta(previous: string, current: string): string {
  if (!current) return "";
  if (current.startsWith(previous)) return current.slice(previous.length);
  return `${previous && !previous.endsWith("\n") ? "\n\n" : ""}${current}`;
}

function singleLine(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function tail(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-(limit - 1))}`;
}

function truncatePreview(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 24).trimEnd()}\n\n… preview truncated`;
}
