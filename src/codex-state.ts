import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

interface WorkspaceRow {
  cwd: unknown;
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
