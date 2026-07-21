import path from "node:path";
import { InlineKeyboard } from "grammy";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
import type { CodexModel, CodexThreadSummary } from "./codex-state.js";
import type { StreamMode } from "./streaming.js";

const WORKSPACE_CALLBACK_PREFIX = "workspace:";
const WORKSPACE_PAGE_PREFIX = "workspace-page:";
const RESUME_CALLBACK_PREFIX = "resume:";
const RESUME_PAGE_PREFIX = "resume-page:";
export const WORKSPACES_PER_PAGE = 8;
export const MODELS_PER_PAGE = 8;
export const THREADS_PER_PAGE = 6;

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

export function resumeKeyboard(threads: readonly CodexThreadSummary[], page = 0, now = Date.now()): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageCount = Math.max(1, Math.ceil(threads.length / THREADS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * THREADS_PER_PAGE;
  threads.slice(start, start + THREADS_PER_PAGE).forEach((thread, offset) => {
    const index = start + offset;
    keyboard.text(resumeButtonLabel(thread, now), `${RESUME_CALLBACK_PREFIX}${index}`).row();
  });
  if (pageCount > 1) {
    if (safePage > 0) keyboard.text("‹ Previous", `${RESUME_PAGE_PREFIX}${safePage - 1}`);
    keyboard.text(`${safePage + 1}/${pageCount}`, "resume-page:noop");
    if (safePage < pageCount - 1) keyboard.text("Next ›", `${RESUME_PAGE_PREFIX}${safePage + 1}`);
  }
  return keyboard;
}

export function modelKeyboard(models: readonly CodexModel[], currentModel?: string, page = 0): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageCount = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * MODELS_PER_PAGE;
  models.slice(start, start + MODELS_PER_PAGE).forEach((model, offset) => {
    const index = start + offset;
    const selected = model.slug === currentModel ? " ✓" : "";
    keyboard.text(`${model.displayName}${selected}`.slice(0, 60), `model:${index}`).row();
  });
  if (pageCount > 1) {
    if (safePage > 0) keyboard.text("‹ Previous", `model-page:${safePage - 1}`);
    keyboard.text(`${safePage + 1}/${pageCount}`, "model-page:noop");
    if (safePage < pageCount - 1) keyboard.text("Next ›", `model-page:${safePage + 1}`);
  }
  return keyboard;
}

export function reasoningKeyboard(current?: ModelReasoningEffort): InlineKeyboard {
  const efforts: ModelReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
  const keyboard = new InlineKeyboard();
  efforts.forEach((effort) => {
    keyboard.text(`${effort}${effort === current ? " ✓" : ""}`, `reasoning:${effort}`);
  });
  return keyboard;
}

export function streamModeKeyboard(current: StreamMode): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const mode of ["off", "brief", "verbose"] as const) {
    keyboard.text(`${mode}${mode === current ? " ✓" : ""}`, `stream:${mode}`);
  }
  return keyboard;
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

export function parseResumeCallback(data: string): number | null {
  if (!data.startsWith(RESUME_CALLBACK_PREFIX)) return null;
  const value = Number(data.slice(RESUME_CALLBACK_PREFIX.length));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseResumePageCallback(data: string): number | null {
  if (!data.startsWith(RESUME_PAGE_PREFIX)) return null;
  const value = Number(data.slice(RESUME_PAGE_PREFIX.length));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function resumeButtonLabel(thread: CodexThreadSummary, now = Date.now()): string {
  const workspace = path.basename(thread.workspace) || thread.workspace;
  const age = formatAge(Math.max(0, now - thread.updatedAt));
  return `${workspace} · ${thread.title} · ${age}`.slice(0, 60);
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
