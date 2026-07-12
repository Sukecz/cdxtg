# AGENTS.md

## Project goal

Keep `cdxtg` a small, understandable, self-hosted Telegram bridge to the official Codex SDK. Prefer a focused dependency and feature set over queues, databases, containers, dashboards, or orchestration until a concrete requirement justifies them.

All public project content must be written in English, including bot messages, documentation, examples, scripts, logs, tests, release notes, and GitHub metadata.

## Safety

- Never commit or print bot tokens, API keys, Codex auth files, Telegram IDs, private paths, or user content.
- Keep `telegram.env`, `.env`, `.codex/`, logs, state, and generated files ignored.
- Telegram input must only be passed as SDK input. Never interpolate it into a shell command.
- Keep an explicit Telegram user allowlist. Workspace discovery may read local Codex thread history, but must ignore stale paths and never accept arbitrary Telegram-supplied paths.
- Default to `read-only`. Expose `danger-full-access` only behind the local `CODEX_ENABLE_FULL_ACCESS` opt-in and an explicit Telegram confirmation.
- Do not add deployment, restart, update, or host-administration commands to the bot without an explicit project decision and additional safeguards.

## Development workflow

1. Inspect the current source and `git status` before changing files.
2. Explain the intended writes before editing.
3. Keep changes narrow and update user-facing documentation with behavior changes.
4. Run `npm run check`, `npm test`, and `npm run build` before finishing.
5. After a completed, verified change, create a scoped Git commit automatically unless the user explicitly asks not to commit. Never include unrelated or pre-existing user changes, and never push without an explicit request.
6. Use Conventional Commit-style messages such as `feat: add workspace selection` or `docs: clarify installation`.

## Versions and releases

- The package uses SemVer syntax because npm requires `MAJOR.MINOR.PATCH`.
- Product releases advance in visible steps only: `0.1`, `0.2`, `0.3`, then `1.0`, `1.1`, and so on. Represent these in `package.json` as `0.1.0`, `0.2.0`, `0.3.0`, `1.0.0`, `1.1.0`.
- Do not publish patch releases such as `0.1.1` or `1.0.1`. Accumulate fixes into the next visible release step.
- A normal source commit does not require a version bump. Bump the version only when preparing a release and update the changelog/readme at the same time.
- Never create tags, push, or publish a release unless explicitly requested.

## Architecture

- Runtime: Node.js 22+ and TypeScript with ESM.
- Telegram: `grammy` long polling by default.
- Codex: official `@openai/codex-sdk`; do not parse human-oriented Codex CLI output.
- Configuration: environment variables loaded from a local ignored file.
- State: in memory for the MVP. Keep interfaces ready for later persistence without introducing a database prematurely.

## Code conventions

- Keep strict TypeScript enabled.
- Prefer small pure functions and dependency injection where it makes tests simple.
- Validate all environment input at startup and fail with actionable messages.
- Split Telegram output safely at its message limit and send plain text unless formatting is fully escaped.
- Handle shutdown signals and cancel active turns cleanly.
- Add or update tests for parsing, authorization, path selection, and message splitting.
- Keep `npm run service:install` as the documented default installation path. It must fail safely when the allowlist is missing and must never copy secret values into the generated unit file.
- Keep `.env.example` as the committed blank template. `npm run setup` may create an ignored `telegram.env`, but it must never overwrite an existing file.
- Keep Telegram allowlist hot reload working so the first authorized user can move from `/id` to normal prompts without restarting the bot.
- Keep `/new` and `/workspace` on the paginated inline picker backed by local Codex thread history plus hot-reloaded `CODEX_WORKSPACES` entries.
