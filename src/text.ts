export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function splitTelegramText(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalized = text.trim() || "Codex completed the task without a text response.";
  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const newline = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    const boundary = Math.max(newline, space);
    const cut = boundary > 0 ? boundary : limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
