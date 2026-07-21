import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

interface WorkspaceRow {
  cwd: unknown;
}

interface ThreadRow {
  id: unknown;
  cwd: unknown;
  title: unknown;
  updated_at: unknown;
  rollout_path: unknown;
}

export interface CodexModel {
  slug: string;
  displayName: string;
}

export interface CodexThreadSummary {
  id: string;
  workspace: string;
  title: string;
  updatedAt: number;
}

export function listCodexThreads(codexDir = defaultCodexDir(), limit = 100): CodexThreadSummary[] {
  if (!codexDir || !existsSync(codexDir)) return [];
  const databasePath = findLatestStateDatabase(codexDir);
  if (!databasePath) return [];

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const columns = new Set(
      (database.prepare("PRAGMA table_info(threads)").all() as Array<{ name?: unknown }>)
        .flatMap((column) => typeof column.name === "string" ? [column.name] : []),
    );
    if (!["id", "cwd"].every((column) => columns.has(column))) return [];
    const title = columns.has("title") ? "title" : "NULL AS title";
    const rolloutPath = columns.has("rollout_path") ? "rollout_path" : "NULL AS rollout_path";
    const updatedAt = columns.has("updated_at_ms")
      ? "updated_at_ms"
      : columns.has("updated_at")
        ? "updated_at"
        : "0";
    const archived = columns.has("archived") ? "AND (archived = 0 OR archived IS NULL)" : "";
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
    const rows = database.prepare(`
      SELECT id, cwd, ${title}, ${updatedAt} AS updated_at, ${rolloutPath}
      FROM threads
      WHERE id IS NOT NULL AND id != '' AND cwd IS NOT NULL AND cwd != '' ${archived}
      ORDER BY ${updatedAt} DESC
      LIMIT ?
    `).all(safeLimit) as unknown as ThreadRow[];

    const seen = new Set<string>();
    return rows.flatMap((row) => {
      if (typeof row.id !== "string" || seen.has(row.id) || typeof row.cwd !== "string") return [];
      if (typeof row.rollout_path === "string" && row.rollout_path && !existsSync(row.rollout_path)) return [];
      try {
        const workspace = realpathSync(path.resolve(row.cwd));
        if (!statSync(workspace).isDirectory()) return [];
        seen.add(row.id);
        return [{
          id: row.id,
          workspace,
          title: cleanThreadTitle(row.title),
          updatedAt: parseTimestamp(row.updated_at),
        }];
      } catch {
        return [];
      }
    });
  } catch (error) {
    console.warn(`Could not read Codex thread history: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    database?.close();
  }
}

export function listCodexWorkspaces(codexDir = defaultCodexDir()): string[] {
  if (!codexDir || !existsSync(codexDir)) return [];
  const databasePath = findLatestStateDatabase(codexDir);
  if (!databasePath) return [];

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT cwd
      FROM threads
      WHERE (archived = 0 OR archived IS NULL) AND cwd IS NOT NULL AND cwd != ''
      GROUP BY cwd
      ORDER BY MAX(updated_at) DESC
      LIMIT 50
    `).all() as unknown as WorkspaceRow[];

    return mergeWorkspaceLists(rows.map((row) => typeof row.cwd === "string" ? row.cwd : ""));
  } catch (error) {
    console.warn(`Could not read Codex workspace history: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    database?.close();
  }
}

export function mergeWorkspaceLists(...lists: ReadonlyArray<readonly string[]>): string[] {
  const workspaces = new Set<string>();
  for (const candidate of lists.flat()) {
    if (!candidate?.trim()) continue;
    try {
      const resolved = realpathSync(path.resolve(candidate));
      if (statSync(resolved).isDirectory()) workspaces.add(resolved);
    } catch {
      // Ignore stale Codex history entries and inaccessible paths.
    }
  }
  return [...workspaces];
}

export function listCodexModels(codexDir = defaultCodexDir()): CodexModel[] {
  if (!codexDir) return [];
  try {
    const payload = JSON.parse(readFileSync(path.join(codexDir, "models_cache.json"), "utf8")) as {
      models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown }>;
    };
    return (payload.models ?? [])
      .filter((model) => model.visibility !== "hide" && model.visibility !== "hidden")
      .map((model) => ({
        slug: typeof model.slug === "string" ? model.slug : "",
        displayName: typeof model.display_name === "string" ? model.display_name : "",
      }))
      .filter((model) => model.slug && model.displayName);
  } catch {
    return [];
  }
}

function findLatestStateDatabase(codexDir: string): string | null {
  try {
    return readdirSync(codexDir)
      .filter((file) => /^state_.*\.sqlite$/i.test(file))
      .map((file) => {
        const fullPath = path.join(codexDir, file);
        return { fullPath, modified: statSync(fullPath).mtimeMs };
      })
      .sort((left, right) => right.modified - left.modified)[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

function defaultCodexDir(): string | null {
  const home = process.env.HOME?.trim();
  return home ? path.join(home, ".codex") : null;
}

function cleanThreadTitle(value: unknown): string {
  if (typeof value !== "string") return "Untitled session";
  const title = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return title.slice(0, 200) || "Untitled session";
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1_000;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
