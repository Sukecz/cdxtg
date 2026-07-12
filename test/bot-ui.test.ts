import { describe, expect, it } from "vitest";
import { modelKeyboard, parseWorkspaceCallback, parseWorkspacePageCallback, reasoningKeyboard, workspaceButtonLabel } from "../src/bot-ui.js";

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
});
