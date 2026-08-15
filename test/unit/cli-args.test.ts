import { describe, expect, it } from "vitest";
import { normalizeMainArgs } from "../../src/cli-args.js";

describe("normalizeMainArgs", () => {
  it("lists providers when no arguments are supplied", () => {
    expect(normalizeMainArgs([])).toEqual(["providers"]);
  });

  it("treats a bare address as a balance command", () => {
    expect(normalizeMainArgs(["0xabc", "--chain", "base"])).toEqual([
      "balance",
      "0xabc",
      "--chain",
      "base",
    ]);
  });

  it.each(["balance", "tx", "contract", "tokens", "gas", "block", "providers", "mcp"])(
    "preserves the %s subcommand",
    (subcommand) => {
      expect(normalizeMainArgs([subcommand, "value"])).toEqual([subcommand, "value"]);
    },
  );

  it.each(["--help", "-h", "--version", "-v"])("preserves the %s root flag", (flag) => {
    expect(normalizeMainArgs([flag])).toEqual([flag]);
  });
});
