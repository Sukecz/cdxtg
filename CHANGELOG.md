# Changelog

## Unreleased

- Add a paginated `/resume` picker for recent sessions across all local Codex workspaces.

## 1.1 — 2026-07-21

- added configurable background Codex rate-limit reset notifications and optional MQTT snapshot publishing;
- added Home Assistant MQTT discovery with friendly sensors for the limit windows actually returned by Codex;
- improved guided configuration and added a secret-safe `npm run config:check` summary;
- added automatic Git-history secret scanning to CI and hardened local environment-file handling.

All notable changes to this project are documented in this file.

## 1.0 — 2026-07-15

- added compact effective model and reasoning-effort information to `/new`, `/status`, and new-session confirmations;
- added Codex account rate-limit windows to `/status`, including remaining capacity and reset times;
- resolved runtime status through the official Codex app-server protocol bundled with the SDK;
- kept status commands portable across platforms and resilient when a Codex version or authentication method does not expose runtime details.

## 0.3 — 2026-07-13

- chained model and reasoning-effort selection for a smoother new-session flow;
- corrected the recommended systemd service so Codex sandbox modes determine filesystem access;
- restored normal service-account access to setgid tools such as `crontab` in confirmed Full Access mode;
- added regression coverage for systemd restrictions that would override write or Full Access modes.

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
