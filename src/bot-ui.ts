import path from "node:path";
import { InlineKeyboard } from "grammy";

const WORKSPACE_CALLBACK_PREFIX = "workspace:";
const WORKSPACE_PAGE_PREFIX = "workspace-page:";
export const WORKSPACES_PER_PAGE = 8;

export function workspaceKeyboard(workspaces: readonly string[], page = 0): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageCount = Math.max(1, Math.ceil(workspaces.length / WORKSPACES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * WORKSPACES_PER_PAGE;
  workspaces.slice(start, start + WORKSPACES_PER_PAGE).forEach((workspace, offset) => {
    const index = start + offset;
    keyboard.text(workspaceButtonLabel(workspace, index), `${WORKSPACE_CALLBACK_PREFIX}${index}`).row();
  });
  if (pageCount > 1) {
    if (safePage > 0) keyboard.text("‹ Previous", `${WORKSPACE_PAGE_PREFIX}${safePage - 1}`);
    keyboard.text(`${safePage + 1}/${pageCount}`, "workspace-page:noop");
    if (safePage < pageCount - 1) keyboard.text("Next ›", `${WORKSPACE_PAGE_PREFIX}${safePage + 1}`);
  }
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

export function parseWorkspacePageCallback(data: string): number | null {
  if (!data.startsWith(WORKSPACE_PAGE_PREFIX)) return null;
  const value = Number(data.slice(WORKSPACE_PAGE_PREFIX.length));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
