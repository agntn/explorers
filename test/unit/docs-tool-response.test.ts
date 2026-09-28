import { describe, expect, it } from "vite-plus/test";
import { tokenizeToolResponse } from "../../docs/app/utils/tool-response.ts";

describe("docs tool response highlighting", () => {
  it("distinguishes labels, values, hashes, statuses and URLs", () => {
    const text =
      "[mempool] Tx 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b\n  Block: 0\n  Value: 50 BTC\n  Status: success\n  Seen: 2009-01-03 18:15:05\n  Explorer: https://mempool.space/tx/4a5e\n";
    const tokens = tokenizeToolResponse(text);
    expect(tokens).toContainEqual({ text: "  Status:", kind: "label" });
    expect(tokens).toContainEqual({ text: "success", kind: "status" });
    expect(tokens).toContainEqual({ text: "50", kind: "number" });
    expect(tokens).toContainEqual({ text: "2009-01-03 18:15:05", kind: "date" });
    expect(tokens).toContainEqual({
      text: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      kind: "hash",
    });
    expect(tokens).toContainEqual({ text: "https://mempool.space/tx/4a5e", kind: "url" });
    expect(tokens.map((token) => token.text).join("")).toBe(text);
  });

  it("marks every transaction status", () => {
    for (const status of ["success", "failed", "pending"]) {
      expect(tokenizeToolResponse(`[${status}]`)).toContainEqual({ text: status, kind: "status" });
    }
  });

  it("preserves empty input, CRLF, tabs and markup as text", () => {
    expect(tokenizeToolResponse("")).toEqual([]);
    const text = '\t<script>alert("1")</script>\r\nkey: <img src=x onerror=alert(1)>\r\n';
    expect(
      tokenizeToolResponse(text)
        .map((token) => token.text)
        .join(""),
    ).toBe(text);
  });
});
