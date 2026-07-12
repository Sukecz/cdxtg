<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/darkbackgroundlogo.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/lightbackgroundlogo.png">
    <img src="assets/lightbackgroundlogo.png" alt="cdxtg logo" width="360">
  </picture>
</p>

<p align="center"><strong>Lightweight, secure control of local Codex through Telegram.</strong></p>

`cdxtg` connects a private Telegram bot to Codex running on your computer or server. Start coding tasks, continue conversations, switch workspaces, and stop active tasks from your phone. Your source code and Codex authentication stay on your machine.

```text
Telegram  <->  cdxtg (grammY)  <->  @openai/codex-sdk  <->  Codex CLI  <->  workspace
```

## Version 0.1 features

- private access through a Telegram user ID allowlist;
- a separate Codex session for each chat;
- Telegram typing status while Codex is working;
- automatic workspace discovery from local Codex thread history;
- an inline workspace picker when starting a new session;
- model and reasoning-effort pickers backed by the local Codex model cache;
- safe `read-only`, opt-in `workspace-write`, and confirmed `danger-full-access` modes;
- cancellation of active tasks;
- direct integration through the official TypeScript SDK without parsing CLI output;
- long polling with no public domain, webhook, database, or extra infrastructure.

> [!WARNING]
> This bot can run a coding agent on your machine. Use it only in a private chat, configure the allowlist, and do not enable `workspace-write` until you understand its impact.

## Requirements

- Linux or macOS;
- Node.js 22 or newer;
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and authenticated;
- a Telegram bot created with [@BotFather](https://t.me/BotFather).

Check your environment:

```bash
node --version
codex --version
codex login status
```

## Quick installation

```bash
git clone https://github.com/Sukecz/cdxtg.git
cd cdxtg
npm ci
npm run setup
```

`npm run setup` creates an ignored `telegram.env` from `.env.example`, sets permissions to `0600`, and never overwrites an existing configuration. Add the token received from BotFather:

```dotenv
TELEGRAM_BOT_TOKEN=123456:replace_me
TELEGRAM_ALLOWED_USER_IDS=
```

Start the bot temporarily to discover your Telegram ID:

```bash
npm run build
npm start
```

Send `/id` to the bot. It will show your numeric Telegram user ID but will not accept Codex tasks yet. Add the ID to `telegram.env`:

```dotenv
TELEGRAM_ALLOWED_USER_IDS=123456789
# Optional extra paths not yet present in Codex history:
CODEX_WORKSPACES=/home/me/projects,/home/me/another-project
```

The running bot hot-reloads `TELEGRAM_ALLOWED_USER_IDS`; your next message is accepted without a restart. Press `Ctrl+C` after testing, then install the persistent service:

```bash
npm run service:install
```

This command builds the app, creates a user-level systemd service, starts it immediately, and enables automatic startup. It does not require `sudo`.

```bash
npm run service:status
```

Separate multiple IDs or extra workspaces with commas. Every configured path must exist and be accessible to the service user.

> [!NOTE]
> `npm start` runs the bot only in the current terminal. Use `npm run service:install` for a persistent installation.

## Telegram commands

Every regular text message becomes a Codex prompt.

| Command | Description |
|---|---|
| `/start` | Welcome message and access status |
| `/help` | Command reference |
| `/id` | Show your Telegram user ID and chat ID |
| `/new` | Choose a workspace and start a new session |
| `/status` | Show workspace, mode, state, model, and Codex thread ID |
| `/workspace` | Open the workspace picker |
| `/workspace 2` | Switch to the second workspace and start a new session |
| `/model` | Select a Codex model for a new session |
| `/reasoning` | Select reasoning effort (`minimal` through `xhigh`) |
| `/mode readonly` | Start a new read-only session |
| `/mode write` | Start a session that may write inside the workspace |
| `/mode full` | Confirm and start a session with full service-user access |
| `/stop` | Stop the active task |
| `/version` | Show the cdxtg version |

Example prompts:

```text
Summarize this project's structure and identify risky areas.
Run the tests, explain the failures, and propose a fix.
Add form validation and verify it with a test.
```

`/new` and `/workspace` display a paginated inline picker. Like TeleCodex, cdxtg reads unique active workspace paths from the latest local `~/.codex/state_*.sqlite` database. Explicit `CODEX_WORKSPACES` entries are merged into this list. Missing and duplicate paths are removed automatically.

Changing the workspace or mode starts a fresh Codex session. Extra workspace configuration is hot-reloaded from `telegram.env`, so adding a path does not require a restart.

Write mode is available only when `CODEX_ENABLE_WRITE=true`. Full Access additionally requires `CODEX_ENABLE_FULL_ACCESS=true` and an explicit confirmation in Telegram. Full Access maps to Codex `danger-full-access`: it disables the filesystem sandbox and can modify anything accessible to the service user.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | Token received from BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | empty | Comma-separated numeric Telegram user IDs; hot-reloaded at runtime |
| `CODEX_WORKSPACES` | current directory | Optional extra paths merged with workspaces found in Codex history |
| `CODEX_MODEL` | Codex default | Optional model passed to the SDK |
| `CODEX_REASONING_EFFORT` | model default | `minimal`, `low`, `medium`, `high`, or `xhigh` |
| `CODEX_DEFAULT_MODE` | `read-only` | `read-only`, `workspace-write`, or `danger-full-access` |
| `CODEX_ENABLE_WRITE` | `false` | Enables switching to write mode; hot-reloaded at runtime |
| `CODEX_ENABLE_FULL_ACCESS` | `false` | Enables confirmed `/mode full`; hot-reloaded at runtime |
| `CODEX_APPROVAL_POLICY` | `never` | SDK approval policy; keep `never` for headless operation |
| `CDXTG_ENV_FILE` | `telegram.env` | Path to the local environment file |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

`telegram.env`, `.env`, Codex state, logs, and other secrets are ignored by Git. Only `.env.example` with nonfunctional placeholder values belongs in the repository.

## Persistent systemd service

Install or update the recommended user-level service:

```bash
npm run service:install
```

Check status and follow logs:

```bash
npm run service:status
journalctl --user -u cdxtg.service -f
```

Remove only the service, without deleting the project or configuration:

```bash
npm run service:uninstall
```

The service runs as the current user, who must have a working `codex login`. An advanced system-level template is available at `deploy/cdxtg.service`. Never place secrets directly in a unit file.

## Development

```bash
npm install
npm run dev
npm run check
npm test
npm run build
```

The package uses SemVer syntax such as `0.1.0`, while public feature releases advance as `0.1`, `0.2`, `0.3`, `1.0`, `1.1`, and so on. The project does not publish small patch-number releases such as `0.1.1`.

## Security boundaries

- Telegram text is passed to the official Codex SDK as input and is never interpolated into a shell command.
- Unauthorized users receive only their own Telegram ID and no Codex access.
- Workspace choices come from local Codex thread history and optional locally configured paths; Telegram users cannot submit arbitrary paths.
- `danger-full-access` requires a local opt-in and an explicit Telegram confirmation.
- Read-only mode is the default; write mode requires a local opt-in.
- The bot does not add network or system privileges beyond those of its service account.

For production use, prefer a dedicated unprivileged account and repositories without production secrets. `cdxtg` is a remote control surface for an agent, not a security sandbox by itself.

## Roadmap

- session persistence and restart recovery;
- image and document input;
- safe delivery of generated artifacts;
- optional webhook mode;
- richer live tool and plan status;
- packaged releases and a guided installer.

## License

[MIT](LICENSE)
