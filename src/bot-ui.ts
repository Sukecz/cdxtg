import path from "node:path";
import { InlineKeyboard } from "grammy";

const WORKSPACE_CALLBACK_PREFIX = "workspace:";

export function workspaceKeyboard(workspaces: readonly string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  workspaces.forEach((workspace, index) => {
    keyboard.text(workspaceButtonLabel(workspace, index), `${WORKSPACE_CALLBACK_PREFIX}${index}`).row();
  });
  return keyboard;
}

export function fullAccessKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Enable Full Access", "mode:full:confirm")
    .text("Cancel", "mode:full:cancel");
}

export function workspaceButtonLabel(workspace: string, index: number): string {
  const name = path.basename(workspace) || workspace;
  return `${index + 1}. ${name}`.slice(0, 60);
}

export function parseWorkspaceCallback(data: string): number | null {
  if (!data.startsWith(WORKSPACE_CALLBACK_PREFIX)) return null;
  const value = Number(data.slice(WORKSPACE_CALLBACK_PREFIX.length));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
