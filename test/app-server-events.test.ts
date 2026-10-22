import { describe, expect, it } from "vitest";
import { previewEvent } from "../src/app-server-events.js";

describe("App Server progress", () => {
  it("assembles agent deltas without mixing separate items", () => {
    const state = new Map<string, string>();
    const event = (id: string, delta: string) => previewEvent({ method: "item/agentMessage/delta", params: { itemId: id, delta } }, state);
    event("first", "Hello ");
    expect(event("first", "world")).toMatchObject({ item: { text: "Hello world" } });
    expect(event("second", "Another message")).toMatchObject({ item: { text: "Another message" } });
  });
  it("bounds tool output and never forwards reasoning content", () => {
    const output = previewEvent({ method: "item/commandExecution/outputDelta", params: { itemId: "cmd", delta: "x".repeat(5000) } }, new Map());
    expect(JSON.stringify(output).length).toBeLessThan(1300);
    const reasoning = previewEvent({ method: "item/completed", params: { item: { id: "r", type: "reasoning", content: ["private reasoning"], summary: ["summary"] } } }, new Map());
    expect(reasoning).toEqual({ type: "item.completed", item: { id: "r", type: "reasoning", text: "" } });
  });
  it("maps file changes and plan progress", () => {
    expect(previewEvent({ method: "item/completed", params: { item: { type: "fileChange", id: "f", status: "completed", changes: [{ path: "file.ts", kind: { type: "add" } }] } } }, new Map())).toMatchObject({ item: { changes: [{ path: "file.ts", kind: "add" }] } });
    expect(previewEvent({ method: "turn/plan/updated", params: { plan: [{ step: "Verify", status: "completed" }] } }, new Map())).toMatchObject({ item: { type: "todo_list", items: [{ text: "Verify", completed: true }] } });
  });
});
