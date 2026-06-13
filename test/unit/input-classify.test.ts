import { describe, it, expect } from "vitest"
import { classifyInput } from "../../src/core/input"

describe("classifyInput", () => {
  it("classifies 0x + 64 hex as txhash", () => {
    const tx = "0x" + "a".repeat(64)
    expect(classifyInput(tx)).toBe("txhash")
  })

  it("classifies 0x + 40 hex as address", () => {
    const addr = "0x" + "a".repeat(40)
    expect(classifyInput(addr)).toBe("address")
  })

  it("classifies ENS names as ens", () => {
    expect(classifyInput("vitalik.eth")).toBe("ens")
    expect(classifyInput("nick.eth")).toBe("ens")
  })

  it("defaults unknown to address", () => {
    expect(classifyInput("not-an-ens-or-address")).toBe("address")
  })

  it("trims whitespace before classification", () => {
    const addr = "0x" + "a".repeat(40)
    expect(classifyInput("  " + addr + "  ")).toBe("address")
  })

  it("rejects too-short hex as address (not txhash)", () => {
    const short = "0xabc"
    expect(classifyInput(short)).toBe("address")
  })

  it("rejects 0x + 65 chars as address (one over txhash length)", () => {
    const tooLong = "0x" + "a".repeat(65)
    expect(classifyInput(tooLong)).toBe("address")
  })
})
