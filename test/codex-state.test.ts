import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listCodexModels, listCodexThreads, listCodexWorkspaces, mergeWorkspaceLists } from "../src/codex-state.js";

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

  it("lists visible models from the local Codex cache", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cdxtg-models-"));
    try {
      writeFileSync(path.join(root, "models_cache.json"), JSON.stringify({ models: [
        { slug: "model-a", display_name: "Model A", visibility: "list" },
        { slug: "hidden", display_name: "Hidden", visibility: "hide" },
      ] }));
      expect(listCodexModels(root)).toEqual([{ slug: "model-a", displayName: "Model A" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Codex thread discovery", () => {
  it("lists recent resumable sessions across valid workspaces", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cdxtg-threads-"));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    const missing = path.join(root, "missing");
    const firstRollout = path.join(root, "first.jsonl");
    const secondRollout = path.join(root, "second.jsonl");
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(firstRollout, "");
    writeFileSync(secondRollout, "");
    const database = new DatabaseSync(path.join(root, "state_1.sqlite"));
    try {
      database.exec(`CREATE TABLE threads (
        id TEXT, cwd TEXT, title TEXT, rollout_path TEXT, archived INTEGER, updated_at_ms INTEGER
      )`);
      const insert = database.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)");
      insert.run("older", first, " Older\n session ", firstRollout, 0, 1_000);
      insert.run("newer", second, "Newer session", secondRollout, 0, 2_000);
      insert.run("archived", first, "Archived", firstRollout, 1, 3_000);
      insert.run("missing-workspace", missing, "Missing", firstRollout, 0, 4_000);
      insert.run("missing-rollout", first, "Missing rollout", path.join(root, "missing.jsonl"), 0, 5_000);

      expect(listCodexThreads(root)).toEqual([
        { id: "newer", workspace: second, title: "Newer session", updatedAt: 2_000_000 },
        { id: "older", workspace: first, title: "Older session", updatedAt: 1_000_000 },
      ]);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
