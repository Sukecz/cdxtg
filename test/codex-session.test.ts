import { describe, expect, it } from "vitest";
import { CodexSession } from "../src/codex-session.js";

describe("CodexSession resume", () => {
  it("binds an existing thread to its workspace while preserving the safe mode", () => {
    const session = new CodexSession({
      workspace: "/old-workspace",
      mode: "read-only",
      approvalPolicy: "never",
    });

    session.resume("thread-123", "/resumed-workspace");

    expect(session.info).toMatchObject({
      threadId: "thread-123",
      workspace: "/resumed-workspace",
      mode: "read-only",
      approvalPolicy: "never",
      busy: false,
    });
  });
});
