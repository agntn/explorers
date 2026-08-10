import { describe, it, expect } from "vitest";
import { formatWei } from "../../src/core/types.js";

describe("formatWei", () => {
  it("formats integer amounts without floating-point rounding", () => {
    expect(formatWei("1234500000000000000")).toBe("1.2345");
    expect(formatWei("-1000000", 6)).toBe("-1");
    expect(formatWei("42", 0)).toBe("42");
  });

  it.each([-1, 1.5, 256])("rejects unsafe token decimals: %s", (decimals) => {
    expect(() => formatWei("1", decimals)).toThrow(RangeError);
  });
});
