<p align="center">
  <img src="assets/logo.png" alt="cdxtg logo" width="180">
</p>

<h1 align="center">cdxtg</h1>

<p align="center"><strong>Lightweight, secure control of local Codex through Telegram.</strong></p>

`cdxtg` connects a private Telegram bot to Codex running on your computer or server. Start coding tasks, continue conversations, switch workspaces, and stop active tasks from your phone. Your source code and Codex authentication stay on your machine.

```text
Telegram  <->  cdxtg (grammY)  <->  @openai/codex-sdk  <->  Codex CLI  <->  workspace
```

## Version 0.1 features

- private access through a Telegram user ID allowlist;
- a separate Codex session for each chat;
- Telegram typing status while Codex is working;
- multiple preconfigured workspaces;
- safe `read-only` and opt-in `workspace-write` modes;
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
git clone https://github.com/YOUR_ACCOUNT/cdxtg.git
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

Separate multiple IDs or workspaces with commas. The first `CODEX_WORKSPACES` entry is the default. Every configured path must exist and be accessible to the service user.

> [!NOTE]
> `npm start` runs the bot only in the current terminal. Use `npm run service:install` for a persistent installation.

## Telegram commands

Every regular text message becomes a Codex prompt.

| Command | Description |
|---|---|
| `/start` | Welcome message and access status |
| `/help` | Command reference |
| `/id` | Show your Telegram user ID and chat ID |
| `/new` | Discard the current session and start a new one |
| `/status` | Show workspace, mode, state, model, and Codex thread ID |
| `/workspace` | List allowed workspaces |
| `/workspace 2` | Switch to the second workspace and start a new session |
| `/mode readonly` | Start a new read-only session |
| `/mode write` | Start a session that may write inside the workspace |
| `/stop` | Stop the active task |
| `/version` | Show the cdxtg version |

Example prompts:

```text
Summarize this project's structure and identify risky areas.
Run the tests, explain the failures, and propose a fix.
Add form validation and verify it with a test.
```

Changing the workspace or mode starts a fresh Codex session. Write mode is available only when `CODEX_ENABLE_WRITE=true` is configured locally.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | Token received from BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | empty | Comma-separated numeric Telegram user IDs; hot-reloaded at runtime |
| `CODEX_WORKSPACES` | current directory | Exact comma-separated workspace allowlist |
| `CODEX_MODEL` | Codex default | Optional model passed to the SDK |
| `CODEX_DEFAULT_MODE` | `read-only` | `read-only` or `workspace-write` |
| `CODEX_ENABLE_WRITE` | `false` | Enables switching to write mode |
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
- A workspace can be selected only from the locally configured exact allowlist.
- `danger-full-access` is not exposed through Telegram.
- Read-only mode is the default; write mode requires a local opt-in.
- The bot does not add network or system privileges beyond those of its service account.

For production use, prefer a dedicated unprivileged account and repositories without production secrets. `cdxtg` is a remote control surface for an agent, not a security sandbox by itself.

## Why the SDK instead of app-server?

Codex provides two relevant integration layers:

- [Codex SDK](https://developers.openai.com/codex/codex-sdk/) is the official library for programmatically controlling local Codex agents and coding threads. It gives this small project sessions, streamed events, sandbox selection, and cancellation without implementing a protocol client.
- [Codex app-server](https://developers.openai.com/codex/app-server/) is a lower-level JSON-RPC interface for deep client integrations. It additionally exposes conversation history, interactive approvals, authentication, model discovery, and detailed product events.

Version 0.1 uses the SDK because it matches the current scope with less code. The integration is isolated behind `CodexSession`, allowing a future app-server backend over local `stdio` or a Unix socket without rewriting the Telegram layer. App-server WebSocket transport should not be exposed publicly and is currently documented as experimental and unsupported.

## Roadmap

- optional app-server backend for history, approvals, and authentication;
- session persistence and restart recovery;
- image and document input;
- safe delivery of generated artifacts;
- optional webhook mode;
- richer live tool and plan status;
- packaged releases and a guided installer.

## License

[MIT](LICENSE)
