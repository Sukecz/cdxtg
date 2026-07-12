import { describe, expect, it } from "vitest";
import { parseWorkspaceCallback, workspaceButtonLabel } from "../src/bot-ui.js";

describe("workspace picker", () => {
  it("uses the directory name as a compact button label", () => {
    expect(workspaceButtonLabel("/srv/projects/example", 1)).toBe("2. example");
  });

  it("parses only valid workspace callbacks", () => {
    expect(parseWorkspaceCallback("workspace:3")).toBe(3);
    expect(parseWorkspaceCallback("workspace:-1")).toBeNull();
    expect(parseWorkspaceCallback("other:3")).toBeNull();
  });
});
