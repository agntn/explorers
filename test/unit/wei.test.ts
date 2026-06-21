import { describe, it, expect } from "vitest"
import { decimalToWei } from "../../src/core/wei"

describe("decimalToWei", () => {
  it("converts 1 to 10^18 wei exactly", () => {
    expect(decimalToWei(1)).toBe("1000000000000000000")
    expect(decimalToWei("1")).toBe("1000000000000000000")
  })

  it("converts 0.5 without precision loss", () => {
    expect(decimalToWei(0.5)).toBe("500000000000000000")
  })

  it("preserves 0.1 exactly (the famous IEEE754 trap)", () => {
    // Number(0.1) * 1e18 gives 100000000000000005.5... — but decimalToWei
    // parses the string "0.1" and gets the exact value.
    expect(decimalToWei("0.1")).toBe("100000000000000000")
  })

  it("preserves 0.001 exactly", () => {
    expect(decimalToWei("0.001")).toBe("1000000000000000")
  })

  it("truncates beyond 18 fractional digits with error", () => {
    expect(() => decimalToWei("0.0000000000000000001")).toThrow(/18 fractional/)
  })

  it("pads short fractions to 18 digits", () => {
    expect(decimalToWei("1.5")).toBe("1500000000000000000")
    expect(decimalToWei("0.000001")).toBe("1000000000000")
  })

  it("accepts integer part only", () => {
    expect(decimalToWei("42")).toBe("42000000000000000000")
  })

  it("handles negative values", () => {
    expect(decimalToWei("-1")).toBe("-1000000000000000000")
  })

  it("rejects non-decimal strings", () => {
    expect(() => decimalToWei("foo")).toThrow(/not a valid decimal/)
    expect(() => decimalToWei("0x123")).toThrow(/not a valid decimal/)
    expect(() => decimalToWei("")).toThrow(/not a valid decimal/)
  })

  it("rejects exponent notation (not a decimal literal)", () => {
    expect(() => decimalToWei("1e18")).toThrow(/not a valid decimal/)
  })
})
