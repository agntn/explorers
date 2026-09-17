import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request in unit test");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
