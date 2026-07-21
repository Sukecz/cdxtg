import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("secret safety", () => {
  it("keeps local runtime configuration ignored and untracked", () => {
    const root = new URL("..", import.meta.url);
    const ignored = execFileSync("git", ["check-ignore", "telegram.env", ".env"], {
      cwd: root,
      encoding: "utf8",
    }).trim().split("\n");
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: root,
      encoding: "utf8",
    }).trim().split("\n");

    expect(ignored).toEqual(["telegram.env", ".env"]);
    expect(tracked).not.toContain("telegram.env");
    expect(tracked).not.toContain(".env");
  });

  it("keeps the committed environment template nonfunctional", () => {
    const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

    expect(template).toContain("TELEGRAM_BOT_TOKEN=123456:replace_me");
    expect(template).not.toMatch(/TELEGRAM_BOT_TOKEN=\d{8,12}:[A-Za-z0-9_-]{30,}/);
    expect(template).not.toMatch(/MQTT_PASSWORD=\S+/);
  });
});
