import { describe, expect, it } from "vitest";
import { parseNumericList, parseWorkspaces } from "../src/config.js";

describe("parseNumericList", () => {
  it("accepts an empty discovery-mode allowlist", () => {
    expect(parseNumericList(undefined)).toEqual([]);
  });

  it("parses comma-separated Telegram IDs", () => {
    expect(parseNumericList("123, 456")).toEqual([123, 456]);
  });

  it("rejects invalid IDs", () => {
    expect(() => parseNumericList("123,nope")).toThrow(/invalid ID/);
  });
});
describe("parseWorkspaces", () => {
  it("canonicalizes and deduplicates existing paths", () => {
    expect(parseWorkspaces(".,.")).toEqual([process.cwd()]);
  });

  it("rejects missing paths", () => {
    expect(() => parseWorkspaces("/definitely/not/a/cdxtg/workspace")).toThrow(/does not exist/);
  });
});
