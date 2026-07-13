import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const systemdSandboxDirectives = [
  "NoNewPrivileges=true",
  "PrivateTmp=true",
  "PrivateDevices=true",
  "ProtectSystem=strict",
  "ProtectHome=read-only",
  "ProtectKernelTunables=true",
  "ProtectKernelModules=true",
  "ProtectControlGroups=true",
  "ProtectKernelLogs=true",
  "RestrictSUIDSGID=true",
  "LockPersonality=true",
  "RestrictRealtime=true",
];

describe("systemd service definitions", () => {
  it.each([
    "scripts/install-user-service.sh",
    "deploy/cdxtg.service",
  ])("does not override Codex write and full-access modes in %s", (file) => {
    const contents = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const lines = contents.split("\n").map((line) => line.trim());

    for (const restriction of systemdSandboxDirectives) {
      expect(lines).not.toContain(restriction);
      expect(lines).not.toContain(`echo '${restriction}'`);
    }
  });
});
