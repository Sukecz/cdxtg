import { describe, expect, it } from "vitest";
import { modelKeyboard, parseResumeCallback, parseResumePageCallback, parseWorkspaceCallback, parseWorkspacePageCallback, reasoningKeyboard, resumeButtonLabel, resumeKeyboard, streamModeKeyboard, workspaceButtonLabel } from "../src/bot-ui.js";

describe("workspace picker", () => {
  it("uses the directory name as a compact button label", () => {
    expect(workspaceButtonLabel("/srv/projects/example", 1)).toBe("2. example");
  });

  it("parses only valid workspace callbacks", () => {
    expect(parseWorkspaceCallback("workspace:3")).toBe(3);
    expect(parseWorkspaceCallback("workspace:-1")).toBeNull();
    expect(parseWorkspaceCallback("other:3")).toBeNull();
  });

  it("parses workspace pagination callbacks", () => {
    expect(parseWorkspacePageCallback("workspace-page:2")).toBe(2);
    expect(parseWorkspacePageCallback("workspace-page:noop")).toBeNull();
  });

  it("marks selected model and reasoning options", () => {
    expect(JSON.stringify(modelKeyboard([{ slug: "a", displayName: "Model A" }], "a"))).toContain("Model A ✓");
    expect(JSON.stringify(reasoningKeyboard("high"))).toContain("high ✓");
  });

  it("marks the selected streaming mode", () => {
    expect(JSON.stringify(streamModeKeyboard("brief"))).toContain("brief ✓");
  });

  it("formats and parses resumable session choices", () => {
    const thread = {
      id: "thread-1",
      workspace: "/srv/projects/example",
      title: "Fix the dashboard",
      updatedAt: Date.UTC(2026, 6, 21, 10),
    };
    const now = Date.UTC(2026, 6, 21, 12);

    expect(resumeButtonLabel(thread, now)).toBe("example · Fix the dashboard · 2h");
    expect(JSON.stringify(resumeKeyboard([thread], 0, now))).toContain("resume:0");
    expect(parseResumeCallback("resume:3")).toBe(3);
    expect(parseResumeCallback("resume:-1")).toBeNull();
    expect(parseResumePageCallback("resume-page:2")).toBe(2);
    expect(parseResumePageCallback("resume-page:noop")).toBeNull();
  });
});
