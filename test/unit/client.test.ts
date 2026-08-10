import { afterEach, describe, expect, it, vi } from "vitest";
import { HTTPError } from "../../src/core/errors.js";
import { getJSON, postJSON } from "../../src/core/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP client", () => {
  it.each([
    ["GET", () => getJSON("https://example.test/data?apikey=secret", { provider: "test" })],
    [
      "POST",
      () =>
        postJSON(
          "https://example.test/data?apikey=secret",
          { query: "value" },
          { provider: "test" },
        ),
    ],
  ])("does not retry failed %s requests", async (_method, request) => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "upstream failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const error = await request().catch((cause: unknown) => cause);

    expect(fetch).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(HTTPError);
    expect(error).toMatchObject({ statusCode: 500, provider: "test" });
    expect((error as Error).message).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it.each([
    ["GET", () => getJSON<{ safe: number; large: string }>("https://example.test/data")],
    [
      "POST",
      () =>
        postJSON<{ safe: number; large: string }>("https://example.test/data", {
          query: "value",
        }),
    ],
  ])(
    "preserves integers beyond Number.MAX_SAFE_INTEGER in %s responses",
    async (_method, request) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response('{"safe":42,"large":123456789012345678901}', {
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );

      await expect(request()).resolves.toEqual({
        safe: 42,
        large: "123456789012345678901",
      });
    },
  );
});
