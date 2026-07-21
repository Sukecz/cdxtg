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

## Features

- private access through a Telegram user ID allowlist;
- a separate Codex session for each chat;
- native Telegram draft streaming in private chats, with message-edit fallback elsewhere;
- `off`, `brief`, and `verbose` streaming modes with throttled updates;
- automatic workspace discovery from local Codex thread history;
- an inline workspace picker when starting a new session;
- model and reasoning-effort pickers backed by the local Codex model cache;
- compact effective model and available Codex rate-limit reporting in session status;
- optional background rate-limit reset notifications and MQTT snapshots;
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

Validate the file without printing tokens or passwords:

```bash
npm run config:check
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

## Choose your setup

Start with only the two required Telegram values. Add optional blocks later; unused features stay disabled.

| Goal | Settings to add |
|---|---|
| Telegram access only | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` |
| Reset alerts in Telegram | `CODEX_RATE_LIMIT_POLL_SECONDS=900` |
| MQTT snapshots | Poll interval plus `MQTT_URL`, and credentials when required |
| Automatic Home Assistant entities | MQTT settings plus `MQTT_HOME_ASSISTANT_DISCOVERY=true` |

Run `npm run config:check` after editing. For an installed service, apply startup-only configuration changes with `npm run service:install`. The allowlist, explicit workspaces, and write/full-access opt-ins are the only settings hot-reloaded while the bot is running.

## Telegram commands

Every regular text message becomes a Codex prompt.

| Command | Description |
|---|---|
| `/start` | Welcome message and access status |
| `/help` | Command reference |
| `/id` | Show your Telegram user ID and chat ID |
| `/new` | Show the effective model, choose a workspace, and start a new session |
| `/status` | Show session details, the effective model, and available Codex rate limits |
| `/workspace` | Open the workspace picker |
| `/workspace 2` | Switch to the second workspace and start a new session |
| `/model` | Select a Codex model, then its reasoning effort, in one flow |
| `/reasoning` | Change only the reasoning effort (`minimal` through `xhigh`) |
| `/stream` | Select `off`, `brief`, or `verbose` streaming |
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

`/new` and `/status` resolve the effective model and reasoning effort through the local Codex app-server protocol. `/status` also shows the rate-limit windows returned for the authenticated Codex account. Older Codex versions and authentication methods that do not expose these fields remain supported; the bot displays a fallback instead of failing the command.

Write mode is available only when `CODEX_ENABLE_WRITE=true`. Full Access additionally requires `CODEX_ENABLE_FULL_ACCESS=true` and an explicit confirmation in Telegram. Full Access maps to Codex `danger-full-access`: it disables the filesystem sandbox and can modify anything accessible to the service user.

## Streaming modes

Streaming defaults to `brief` and can be changed per chat with `/stream`:

- `off` keeps only the working placeholder, typing indicator, and final answer;
- `brief` streams the emerging agent response plus compact command, file, web, tool, and plan status;
- `verbose` additionally shows the latest bounded tool-output tail and expanded plan.

In private chats, cdxtg uses Telegram's native ephemeral `sendMessageDraft` preview. Drafts are refreshed during long turns and replaced by a normal persistent final message. In groups or when drafts are unavailable, cdxtg edits one placeholder message instead. Updates are coalesced to avoid Telegram flood limits, previews are capped below Telegram's 4096-character limit, and long final answers are split safely.

Raw reasoning text is never sent to Telegram. Verbose command output may contain data printed by local tools, so use it only in a trusted private chat.

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
| `TELEGRAM_STREAM_MODE` | `brief` | Default streaming mode: `off`, `brief`, or `verbose` |
| `CODEX_RATE_LIMIT_POLL_SECONDS` | `0` | Background poll interval; `0` disables monitoring, otherwise minimum `30` |
| `CODEX_RATE_LIMIT_RESET_DROP_PERCENT` | `5` | Usage decrease treated as an unscheduled reset |
| `TELEGRAM_RATE_LIMIT_NOTIFICATIONS` | `true` | Send detected reset events to Telegram |
| `TELEGRAM_RATE_LIMIT_CHAT_IDS` | allowlist IDs | Comma-separated notification chat IDs |
| `MQTT_URL` | empty | Broker URL; empty disables MQTT publishing |
| `MQTT_TOPIC` | `cdxtg/codex/rate-limits` | Snapshot publish topic without wildcards |
| `MQTT_USERNAME` | empty | Optional broker username |
| `MQTT_PASSWORD` | empty | Optional broker password |
| `MQTT_QOS` | `0` | MQTT QoS: `0`, `1`, or `2` |
| `MQTT_RETAIN` | `true` | Retain the latest snapshot on the broker |
| `MQTT_HOME_ASSISTANT_DISCOVERY` | `false` | Publish a retained Home Assistant MQTT device discovery payload |
| `MQTT_HOME_ASSISTANT_DISCOVERY_PREFIX` | `homeassistant` | Home Assistant discovery prefix |
| `MQTT_HOME_ASSISTANT_DEVICE_ID` | `cdxtg_codex` | Stable discovery device identifier |
| `MQTT_HOME_ASSISTANT_DEVICE_NAME` | `Codex Usage` | Device name shown in Home Assistant |

`telegram.env`, `.env`, Codex state, logs, and other secrets are ignored by Git. Only `.env.example` with nonfunctional placeholder values belongs in the repository.

> [!IMPORTANT]
> Never put real values in `.env.example`, source files, service units, issues, screenshots, or command output. Before committing, `git check-ignore telegram.env` should print `telegram.env`, while `git ls-files telegram.env` should print nothing. If a real credential is ever committed, removing the line is not enough: rotate the credential immediately because it remains in Git history.

## Rate-limit monitoring

cdxtg can poll the authenticated Codex account in the background, notify Telegram chats when a reset is detected, and publish every successful snapshot to MQTT. It uses the local Codex app-server protocol, so no Codex token is copied into cdxtg configuration.

Monitoring is disabled by default. A practical Telegram-only configuration checks every 15 minutes:

```dotenv
CODEX_RATE_LIMIT_POLL_SECONDS=900
```

Reset notifications default to every private chat ID in `TELEGRAM_ALLOWED_USER_IDS`. Use explicit chat IDs, including an authorized group chat, or disable Telegram delivery independently:

```dotenv
TELEGRAM_RATE_LIMIT_NOTIFICATIONS=true
TELEGRAM_RATE_LIMIT_CHAT_IDS=123456789,-1001234567890
CODEX_RATE_LIMIT_RESET_DROP_PERCENT=5
```

The monitor establishes an initial baseline without sending a notification. It then detects both a new backend reset cycle and an unscheduled usage drop at or above the configured threshold. State is intentionally in memory, so restarting cdxtg establishes a fresh baseline and does not generate a false reset alert.

To publish retained JSON snapshots on every successful poll, configure MQTT:

```dotenv
MQTT_URL=mqtts://broker.example.com:8883
MQTT_TOPIC=home/codex/rate-limits
MQTT_USERNAME=cdxtg
MQTT_PASSWORD=replace_me
MQTT_QOS=1
MQTT_RETAIN=true
MQTT_HOME_ASSISTANT_DISCOVERY=true
```

`MQTT_URL` accepts `mqtt://`, `mqtts://`, `ws://`, or `wss://`; leaving it empty disables MQTT. The payload contains `observedAt` plus primary and secondary windows with `usedPercent`, `remainingPercent`, `windowDurationMinutes`, and an ISO `resetsAt` value. Credentials stay only in the ignored local environment file.

When Home Assistant discovery is enabled, cdxtg publishes one retained MQTT device configuration under the configured discovery prefix. Home Assistant automatically creates a `Codex Usage` device with remaining-capacity and reset-time sensors for each limit window actually returned by Codex, plus a last-update timestamp. User-facing names describe the real window, such as `5h remaining` or `Weekly reset`; unavailable internal slots are not exposed. The discovery prefix, stable device ID, and display name are configurable; no Home Assistant YAML is required.

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

The service runs as the current user, who must have a working `codex login`. The generated unit intentionally does not add a second systemd sandbox: even apparently unrelated systemd restrictions can imply `NoNewPrivileges` or a mount namespace, override the selected Codex mode, and break normal user tools such as `crontab`. Read and write boundaries are enforced by the Codex sandbox selected in Telegram. Full Access still grants only the permissions already available to the service account; it does not grant root access or passwordless `sudo`.

An advanced system-level template is available at `deploy/cdxtg.service`. Never place secrets directly in a unit file.

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
- packaged releases and a guided installer.

## License

[MIT](LICENSE)
