import { describe, expect, it } from "vitest";
import { splitTelegramText } from "../src/text.js";

describe("splitTelegramText", () => {
  it("keeps short messages intact", () => {
    expect(splitTelegramText("hotovo", 20)).toEqual(["hotovo"]);
  });

  it("splits long messages without losing content", () => {
    const chunks = splitTelegramText("jedna dva tri čtyři pět šest", 12);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
    expect(chunks.join(" ")).toBe("jedna dva tri čtyři pět šest");
  });

  it("provides a useful fallback for an empty Codex response", () => {
    expect(splitTelegramText("")[0]).toMatch(/bez textové odpovědi/);
  });
});
