import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listCodexWorkspaces, mergeWorkspaceLists } from "../src/codex-state.js";

describe("Codex workspace discovery", () => {
  it("reads unique recent workspaces from the latest Codex state database", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cdxtg-state-"));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    mkdirSync(first);
    mkdirSync(second);
    const database = new DatabaseSync(path.join(root, "state_1.sqlite"));
    try {
      database.exec("CREATE TABLE threads (cwd TEXT, archived INTEGER, updated_at INTEGER)");
      const insert = database.prepare("INSERT INTO threads VALUES (?, ?, ?)");
      insert.run(first, 0, 1);
      insert.run(second, 0, 3);
      insert.run(first, 0, 2);
      expect(listCodexWorkspaces(root)).toEqual([second, first]);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges configured and discovered workspaces without duplicates or stale paths", () => {
    expect(mergeWorkspaceLists([process.cwd()], [process.cwd(), "/missing/cdxtg-path"]))
      .toEqual([process.cwd()]);
  });
});
