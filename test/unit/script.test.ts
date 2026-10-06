import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { collectInscriptions, collectOpReturns } from "../../src/core/script.ts";
import { FIRST_INSCRIPTION, HTML_INSCRIPTION } from "./inscription-witnesses.ts";

/* Taproot key path spend: one signature and nothing else. */
const KEY_PATH = [
  "abababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab",
];

/* Control block standing in for the real one; the reader never looks inside it. */
const CONTROL = "c0" + "11".repeat(32);

/* A tapscript of the given hex parts behind a pubkey and OP_CHECKSIG, as a script path witness. */
function scriptPath(...parts: readonly string[]): string[] {
  return ["aa".repeat(64), `20${"22".repeat(32)}ac${parts.join("")}`, CONTROL];
}

function sha256(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

describe("collectOpReturns", () => {
  it("reads the pushes after the OP_FALSE OP_RETURN Bitcoin SV writes", () => {
    /* Output 0 of d13af0cc…fbbf on Bitcoin SV, from WhatsOnChain. */
    const script =
      "006a0943455254494841534801012003d3d5477ba37daaf0077e084d4ada7c195ed216ca09e806927b01b4f8bcce52046ac50714046ac50840200eab8447a273db19008634ea49f776559e136be88ec90066f95c81300d6ea80c20384a301b871e457497e86de5ae3d02b2406c81c2a7939fe00f4b899a87c54e6a473045022100e2b2a7b152bb1f03b40a15e8031b64802829e0927e933943445a0e3f179d05dc02206355981a439166ad9cdc6c0626d7e61ba3cacd00c2d2c3e53210ffac540761ce";

    const payloads = collectOpReturns([script]);

    expect(payloads?.[0]).toEqual({ hex: "434552544948415348", text: "CERTIHASH" });
    expect(payloads).toHaveLength(8);
  });

  it("leaves an output that only starts with OP_FALSE alone", () => {
    expect(collectOpReturns(["0014" + "33".repeat(20)])).toBeUndefined();
  });

  it("skips missing scripts and keeps output order", () => {
    expect(collectOpReturns([undefined, "6a0161", null, "6a0162"])).toEqual([
      { hex: "61", text: "a" },
      { hex: "62", text: "b" },
    ]);
  });
});

describe("collectInscriptions", () => {
  it("reads inscription 0 byte for byte", () => {
    const [inscription] = collectInscriptions([FIRST_INSCRIPTION]) ?? [];

    expect(inscription).toMatchObject({ input: 0, contentType: "image/png", size: 793 });
    expect(inscription?.text).toBeUndefined();
    /* SHA-256 of https://ordinals.com/content/6fb976ab…2799i0 */
    expect(sha256(inscription?.hex ?? "")).toBe(
      "846d05123db3601c8591bd144f474f1fbe7f873f3af04db4cab326db73f8d087",
    );
  });

  it("gives a text body its text reading", () => {
    const [inscription] = collectInscriptions([HTML_INSCRIPTION]) ?? [];

    expect(inscription).toMatchObject({ contentType: "text/html;charset=utf-8", size: 625 });
    expect(inscription?.text?.startsWith("<!DOCTYPE html>")).toBe(true);
    /* SHA-256 of https://ordinals.com/content/114c5c87…0fffi0 */
    expect(sha256(inscription?.hex ?? "")).toBe(
      "866756b17f6baa27bb2d30e9f5bfef118e6329ccdc0a974d0c4bd86fce3acb25",
    );
  });

  it("names the input each inscription came from", () => {
    const found = collectInscriptions([KEY_PATH, undefined, HTML_INSCRIPTION]);

    expect(found?.map((inscription) => inscription.input)).toEqual([2]);
  });

  it("finds nothing in a key path spend or a plain transaction", () => {
    expect(collectInscriptions([KEY_PATH, []])).toBeUndefined();
  });

  it("reads the tapscript past an annex", () => {
    const witness = [
      ...scriptPath("0063036f7264", "0101", "0a746578742f706c61696e", "00", "026869", "68"),
      "50aa",
    ];

    expect(collectInscriptions([witness])).toEqual([
      { input: 0, contentType: "text/plain", size: 2, hex: "6869", text: "hi" },
    ]);
  });

  it("reads a key path spend with an annex as no tapscript at all", () => {
    const [, tapscriptWithEnvelope] = scriptPath("0063036f7264", "00", "026869", "68");

    expect(collectInscriptions([[tapscriptWithEnvelope ?? "", "50aa"]])).toBeUndefined();
  });

  it("takes OP_1 as the content type tag and keeps the encoding", () => {
    const witness = scriptPath(
      "0063036f7264",
      "51",
      "0a746578742f706c61696e",
      "59",
      "026272",
      "00",
      "03ffeedd",
      "68",
    );

    expect(collectInscriptions([witness])).toEqual([
      { input: 0, contentType: "text/plain", contentEncoding: "br", size: 3, hex: "ffeedd" },
    ]);
  });

  it("joins body chunks and reads every envelope in one script", () => {
    const witness = scriptPath(
      "0063036f7264",
      "00",
      "026869",
      "0120",
      "68",
      "0063036f7264",
      "0101",
      "0a746578742f706c61696e",
      "68",
    );

    expect(collectInscriptions([witness])).toEqual([
      { input: 0, size: 3, hex: "686920", text: "hi " },
      { input: 0, contentType: "text/plain", size: 0 },
    ]);
  });

  it("keeps only the size of a body past 4096 bytes", () => {
    const witness = scriptPath("0063036f7264", "00", "4d0110", "61".repeat(4097), "68");

    expect(collectInscriptions([witness])).toEqual([{ input: 0, size: 4097 }]);
  });

  it("leaves out a content type that would break onto a second line", () => {
    const contentType = Buffer.from("text/plain\nStatus: forged").toString("hex");
    const witness = scriptPath(
      "0063036f7264",
      "0101",
      `${(contentType.length / 2).toString(16)}${contentType}`,
      "00",
      "026869",
      "68",
    );

    expect(collectInscriptions([witness])).toEqual([
      { input: 0, size: 2, hex: "6869", text: "hi" },
    ]);
  });

  it("reads an envelope written with longer push encodings than it needs", () => {
    const witness = scriptPath(
      "4c00",
      "63",
      "4c036f7264",
      "0101",
      "4c0a746578742f706c61696e",
      "4c00",
      "026869",
      "68",
    );

    expect(collectInscriptions([witness])).toEqual([
      { input: 0, contentType: "text/plain", size: 2, hex: "6869", text: "hi" },
    ]);
  });

  it("drops an envelope another opcode breaks into", () => {
    const witness = scriptPath("0063036f7264", "00", "026869", "ac", "68");

    expect(collectInscriptions([witness])).toBeUndefined();
  });

  it("ignores an OP_IF branch that is not ord", () => {
    const witness = scriptPath("006303626f62", "00", "026869", "68");

    expect(collectInscriptions([witness])).toBeUndefined();
  });
});
