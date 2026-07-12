<p align="center">
  <img src="assets/logo.png" alt="cdxtg logo" width="180">
</p>

<h1 align="center">cdxtg</h1>

<p align="center"><strong>Lehké a bezpečné ovládání lokálního Codexu přes Telegram.</strong></p>

`cdxtg` propojí soukromého Telegram bota s Codexem běžícím na vašem počítači nebo serveru. Z telefonu můžete zadávat úkoly, pokračovat v konverzaci, přepínat pracovní složky a zastavit právě běžící úlohu. Zdrojové kódy i přihlášení ke Codexu zůstávají na vašem stroji.

```text
Telegram  <->  cdxtg (grammY)  <->  @openai/codex-sdk  <->  Codex CLI  <->  workspace
```

## Co umí verze 0.1

- soukromý přístup pomocí allowlistu Telegram user ID;
- samostatná Codex relace pro každý chat;
- průběžný Telegram indikátor „píše…“ během práce;
- více předem povolených pracovních složek;
- bezpečný `read-only` a zapisovací `workspace-write` režim;
- zastavení běžící úlohy;
- přímé napojení přes oficiální TypeScript SDK bez parsování výstupu CLI;
- long polling bez veřejné domény, webhooku, databáze nebo další infrastruktury.

> [!WARNING]
> Bot dokáže spouštět coding agenta na vašem stroji. Používejte ho jen v soukromém chatu, nastavte allowlist a nezačínejte s režimem `workspace-write`, dokud nerozumíte jeho dopadům.

## Požadavky

- Linux nebo macOS;
- Node.js 22 nebo novější;
- nainstalovaný a přihlášený [Codex CLI](https://developers.openai.com/codex/cli/);
- Telegram bot vytvořený přes [@BotFather](https://t.me/BotFather).

Ověření prostředí:

```bash
node --version
codex --version
codex login status
```

## Rychlá instalace

```bash
git clone https://github.com/YOUR_ACCOUNT/cdxtg.git
cd cdxtg
npm ci
cp .env.example telegram.env
chmod 600 telegram.env
```

Do `telegram.env` vložte token od BotFather:

```dotenv
TELEGRAM_BOT_TOKEN=123456:replace_me
```

Při prvním spuštění zatím nenastavujte allowlist:

```bash
npm run build
npm start
```

Napište botovi `/id`. Bot zobrazí vaše číselné Telegram user ID, ale bez allowlistu nepřijme žádný Codex úkol. Proces ukončete pomocí `Ctrl+C`, doplňte ID a nastavte workspace:

```dotenv
TELEGRAM_ALLOWED_USER_IDS=123456789
CODEX_WORKSPACES=/home/me/projects,/home/me/another-project
```

Potom bot znovu spusťte:

```bash
npm run service:install
```

Tento příkaz aplikaci sestaví, vytvoří user-level systemd službu, ihned ji spustí a zapne automatický start po přihlášení nebo startu uživatelského systemd manageru. Nevyžaduje `sudo`. Stav ověříte pomocí:

```bash
npm run service:status
```

Více ID i workspace oddělujte čárkou. První položka `CODEX_WORKSPACES` je výchozí. Cesty musí existovat a služba k nim musí mít potřebná práva.

> [!NOTE]
> `npm start` spouští bota pouze v aktuálním terminálu. Po zavření terminálu se zastaví. Pro běžnou instalaci proto použijte `npm run service:install`.

## Ovládání

Každá obyčejná textová zpráva je prompt pro Codex. Příkazy:

| Příkaz | Funkce |
|---|---|
| `/start` | Uvítání a rychlý stav konfigurace |
| `/help` | Přehled příkazů |
| `/id` | Zobrazí vaše Telegram user ID a chat ID |
| `/new` | Zahodí aktuální relaci a začne novou |
| `/status` | Workspace, režim, stav a ID Codex vlákna |
| `/workspace` | Vypíše povolené pracovní složky |
| `/workspace 2` | Přepne na druhou povolenou složku a založí novou relaci |
| `/mode readonly` | Nová relace pouze pro čtení |
| `/mode write` | Nová relace smí zapisovat uvnitř workspace |
| `/stop` | Zastaví právě běžící úlohu |
| `/version` | Verze služby |

Příklady zpráv:

```text
Shrň mi strukturu tohoto projektu a najdi riziková místa.
Spusť testy, vysvětli chyby a navrhni opravu.
Přidej validaci formuláře a ověř ji testem.
```

Změna workspace nebo režimu vždy vytvoří novou Codex relaci. Režim `write` je dostupný pouze tehdy, když je v konfiguraci `CODEX_ENABLE_WRITE=true`.

## Konfigurace

| Proměnná | Výchozí hodnota | Popis |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | povinná | Token od BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | prázdná | Povolená Telegram user ID oddělená čárkou |
| `CODEX_WORKSPACES` | aktuální složka | Přesný seznam povolených pracovních složek |
| `CODEX_MODEL` | výchozí Codex model | Volitelný model předaný SDK |
| `CODEX_DEFAULT_MODE` | `read-only` | `read-only` nebo `workspace-write` |
| `CODEX_ENABLE_WRITE` | `false` | Povolí přepnutí do zapisovacího režimu |
| `CODEX_APPROVAL_POLICY` | `never` | Approval policy SDK; pro headless provoz ponechte `never` |
| `CDXTG_ENV_FILE` | `telegram.env` | Cesta k env souboru |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` nebo `error` |

`telegram.env`, `.env`, stav Codexu, logy i jiné secrets jsou ignorované Gitem. Do repozitáře patří pouze `.env.example` s neplatnými ukázkovými hodnotami.

## Běh jako systemd služba

Pro doporučenou user-level instalaci stačí:

```bash
npm run service:install
```

Stav a logy:

```bash
npm run service:status
journalctl --user -u cdxtg.service -f
```

Odinstalace služby nesmaže projekt ani konfiguraci:

```bash
npm run service:uninstall
```

Služba běží pod aktuálním uživatelem, který proto musí mít funkční `codex login`. Pokročilá systémová šablona pro správce je v `deploy/cdxtg.service`. Nikdy nevkládejte token přímo do unit souboru.

## Vývoj

```bash
npm install
npm run dev
npm run check
npm test
npm run build
```

Projekt používá SemVer technicky jako `0.1.0`, ale veřejné funkční verze postupují po větších krocích `0.1`, `0.2`, `0.3`, `1.0`, `1.1` — bez drobných release čísel typu `0.1.1`.

## Bezpečnostní hranice

- Telegram text se nikdy neskládá do shellového příkazu; posílá se jako vstup oficiálnímu Codex SDK.
- Neautorizovaný uživatel dostane jen své vlastní Telegram ID a žádný přístup ke Codexu.
- Workspace lze vybrat pouze z lokálně nakonfigurovaného seznamu.
- `danger-full-access` z Telegramu není podporován.
- Výchozí režim je pouze pro čtení; zápis vyžaduje lokální opt-in.
- Bot nepřidává další síťová nebo systémová oprávnění nad možnosti účtu, pod kterým běží.

Pro produkční použití doporučujeme samostatný neprivilegovaný účet a repozitáře bez produkčních secrets. `cdxtg` je vzdálené ovládání agenta, nikoli bezpečnostní sandbox samo o sobě.

## Proč SDK a ne app-server?

Codex nabízí dvě relevantní integrační vrstvy:

- [Codex SDK](https://developers.openai.com/codex/codex-sdk/) je oficiální knihovna pro programové řízení lokálních Codex agentů a coding vláken. Pro malé `cdxtg` poskytuje potřebné relace, streamované eventy, sandbox a rušení úloh s minimem vlastního protokolu.
- [Codex app-server](https://developers.openai.com/codex/app-server/) je nízkoúrovňové JSON-RPC rozhraní pro hluboké klientské integrace. Navíc nabízí například historii, interaktivní approvals, přihlášení, seznam modelů a detailní produktové události.

Verze 0.1 používá SDK, protože je lehčí a odpovídá současnému rozsahu. Integrace je uzavřena za `CodexSession`, takže lze backend později vyměnit za lokální app-server přes `stdio` nebo Unix socket bez přepisu Telegram vrstvy. App-server WebSocket není vhodné vystavovat na internet; jeho dokumentace jej aktuálně označuje jako experimentální a unsupported.

## Roadmapa

- volitelný app-server backend pro historii, approvals a přihlášení;
- perzistence a obnovení relací po restartu;
- obrázky a dokumenty jako vstup;
- bezpečné odesílání vytvořených artefaktů;
- volitelný webhook režim;
- lepší průběžné statusy nástrojů a plánů;
- balíček a instalační průvodce.

## Licence

[MIT](LICENSE)
