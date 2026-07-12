# Changelog

All notable changes to this project are documented in this file.

## 0.2 — 2026-07-12

- native Telegram `sendMessageDraft` streaming for private chats;
- edit-in-place fallback for groups and unsupported draft clients;
- selectable `off`, `brief`, and `verbose` streaming modes;
- throttled agent text, command, file, web, MCP tool, and plan progress;
- bounded verbose tool-output previews without raw reasoning exposure;
- persistent chunked final responses after ephemeral previews.

## 0.1 — 2026-07-12

- first functional Telegram-to-Codex bridge;
- Telegram user allowlisting and automatic workspace discovery from Codex history;
- per-chat Codex sessions through the official TypeScript SDK;
- `read-only` and opt-in `workspace-write` modes;
- commands for status, workspace selection, mode changes, new sessions, and task cancellation;
- inline workspace selection for new sessions and optional confirmed Full Access;
- model and reasoning-effort selection with status reporting;
- systemd templates, tests, GitHub CI, and installation documentation.
