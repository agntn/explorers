/**
 * What a transaction in the Bitcoin family hides in its scripts: OP_RETURN pushes in the outputs,
 * Ordinals inscriptions in the input witnesses. One reader, so a message decodes the same way
 * whichever explorer served it.
 */

import type { Inscription, OpReturnPayload } from "./types.ts";

/** A data carrier opens with OP_RETURN, or with OP_FALSE OP_RETURN as Bitcoin SV writes it. */
const OP_RETURN_SCRIPT = /^(?:00)?6a/i;

/** The protocol tag `ord` as hex; a tapscript without these bytes holds no envelope. */
const PROTOCOL_ID = "6f7264";

/** Largest inscription body handed out as hex and text; bigger ones keep their size only. */
const MAX_INSCRIPTION_BYTES = 4096;

const OP_0 = 0x00;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

const OP_1NEGATE = 0x4f;
const OP_RESERVED = 0x50;
const OP_1 = 0x51;
const OP_16 = 0x60;
const OP_IF = 0x63;
const OP_ENDIF = 0x68;

/** The annex of a taproot witness starts with this byte (BIP 341). */
const ANNEX_TAG = "50";

/** Envelope tags of the fields read here, as the ord reference implementation numbers them. */
const CONTENT_TYPE_TAG = "01";
const CONTENT_ENCODING_TAG = "09";

/** Push opcodes that spell their length out, and how many bytes that length takes. */
const PUSHDATA_WIDTH: Record<number, number> = {
  [OP_PUSHDATA1]: 1,
  [OP_PUSHDATA2]: 2,
  [OP_PUSHDATA4]: 4,
};

/** One script instruction: the opcode, and the bytes it pushes when it is a push. */
interface Instruction {
  readonly opcode: number;
  readonly data?: Uint8Array;
}

let utf8: TextDecoder | undefined;

/* `ignoreBOM` means "leave a leading U+FEFF in the string", which is where the filter can see it. */
function decoder(): TextDecoder {
  utf8 ??= new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return utf8;
}

/** Format characters, invisible on screen, and the line separators no renderer splits on. */
const UNPRINTABLE = /[\p{Cf}\p{Zl}\p{Zp}]/u;

/*
 * Decide whether decoded chain data is worth showing as text.
 *
 * A payload anyone can pay to publish must not steer a terminal, reorder the line that renders it,
 * or hide bytes behind characters nobody can see, because the CLI prints this text straight out.
 * Out of the C0 and C1 control blocks only tab and newline survive: real messages write paragraphs
 * with them, and the renderers indent a continuation line so it cannot pose as another field. The
 * trade is that a joiner carries meaning in Persian spelling and in emoji sequences, and those
 * payloads arrive as hex.
 */
function isPrintable(text: string): boolean {
  if (UNPRINTABLE.test(text)) return false;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) return false;
    if (code >= 0x7f && code <= 0x9f) return false;
  }

  return true;
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return undefined;

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* Read a payload as text, leaving binary carriers (Runes, Omni, hashes) without a text reading. */
function decodeText(payload: Uint8Array): string | undefined {
  try {
    const text = decoder().decode(payload);
    return isPrintable(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

function toPayload(bytes: Uint8Array): OpReturnPayload {
  return { hex: toHex(bytes), text: decodeText(bytes) };
}

/* Read a little-endian push length. Callers check first that all `width` bytes are there. */
function readPushLength(script: Uint8Array, offset: number, width: number): number {
  let length = 0;
  for (let i = 0; i < width; i += 1) {
    length += (script[offset + i] ?? 0) * 256 ** i;
  }
  return length;
}

/*
 * Value an opcode pushes on its own, for the small constants that carry no bytes after them.
 *
 * Nothing comes back for OP_RESERVED: Bitcoin Core counts it as push-type in `IsPushOnly`, yet it
 * leaves no data behind.
 */
function constantPush(opcode: number): Uint8Array | undefined {
  if (opcode === OP_0) return new Uint8Array();
  if (opcode === OP_1NEGATE) return Uint8Array.of(0x81);
  if (opcode >= OP_1 && opcode <= OP_16) return Uint8Array.of(opcode - OP_1 + 1);
  return undefined;
}

function dataPush(
  script: Uint8Array,
  cursor: number,
  opcode: number,
): { readonly cursor: number; readonly length: number } | undefined {
  const width = PUSHDATA_WIDTH[opcode];
  if (width === undefined) return { cursor, length: opcode };
  if (cursor + width > script.length) return undefined;
  return { cursor: cursor + width, length: readPushLength(script, cursor, width) };
}

/* One instruction at `cursor` and where the next starts, or nothing for a truncated push. */
function readInstruction(
  script: Uint8Array,
  cursor: number,
): { readonly instruction: Instruction; readonly next: number } | undefined {
  const opcode = script[cursor] ?? 0;
  const after = cursor + 1;
  if (opcode > OP_16 || opcode === OP_RESERVED) return { instruction: { opcode }, next: after };

  const constant = constantPush(opcode);
  if (constant !== undefined) return { instruction: { opcode, data: constant }, next: after };

  const push = dataPush(script, after, opcode);
  if (!push || push.cursor + push.length > script.length) return undefined;
  const end = push.cursor + push.length;
  return { instruction: { opcode, data: script.subarray(push.cursor, end) }, next: end };
}

/* Walk a script from `start`; a truncated push ends the walk with whatever came before it. */
function instructions(script: Uint8Array, start: number): Instruction[] {
  const result: Instruction[] = [];
  let cursor = start;
  while (cursor < script.length) {
    const step = readInstruction(script, cursor);
    if (!step) break;
    result.push(step.instruction);
    cursor = step.next;
  }
  return result;
}

/*
 * Read the data pushes of an OP_RETURN output.
 *
 * Any other output yields nothing, and is rejected on the hex so a busy address does not pay to
 * decode thousands of ordinary scripts. The walk covers what Bitcoin Core calls push-only: an
 * opcode below OP_PUSHDATA1 is its own byte count, the small constants push themselves, and
 * anything above OP_16 or a truncated push ends the walk with whatever came before it.
 */
function parseOpReturn(scriptHex: string): OpReturnPayload[] {
  const prefix = OP_RETURN_SCRIPT.exec(scriptHex);
  if (!prefix) return [];

  const script = hexToBytes(scriptHex);
  if (!script) return [];

  const payloads: OpReturnPayload[] = [];
  for (const { opcode, data } of instructions(script, prefix[0].length / 2)) {
    if (opcode === OP_RESERVED) continue;
    if (!data) break;
    payloads.push(toPayload(data));
  }
  return payloads;
}

/**
 * Gather the OP_RETURN payloads of every output script.
 *
 * @param scripts - Output scripts as hex, in output order; a missing one is skipped.
 * @returns {OpReturnPayload[] | undefined} The pushes, or `undefined` when no output carries any.
 */
export function collectOpReturns(
  scripts: readonly (string | null | undefined)[],
): OpReturnPayload[] | undefined {
  const payloads = scripts.flatMap((script) => (script ? parseOpReturn(script) : []));
  return payloads.length > 0 ? payloads : undefined;
}

/* The leaf script as rust-bitcoin's `tapscript()` finds it for ord: no control block check. */
function tapscript(witness: readonly string[]): string | undefined {
  const last = witness.at(-1);
  if (last === undefined || witness.length < 2) return undefined;
  if (last.startsWith(ANNEX_TAG)) return witness.length >= 3 ? witness.at(-3) : undefined;
  return witness.at(-2);
}

/* The pushes between the envelope mark and OP_ENDIF, or nothing when another opcode breaks in. */
function envelopePushes(
  steps: readonly Instruction[],
  start: number,
): readonly Uint8Array[] | undefined {
  const pushes: Uint8Array[] = [];
  for (const { opcode, data } of steps.slice(start)) {
    if (opcode === OP_ENDIF) return pushes;
    if (!data) return undefined;
    pushes.push(data);
  }
  return undefined;
}

/* An empty push, OP_IF, then a push of `ord`, matched by value as ord does, not by encoding. */
function opensEnvelope(steps: readonly Instruction[], at: number): boolean {
  const [flag, branch, protocol] = [steps[at], steps[at + 1], steps[at + 2]];
  if (flag?.data?.length !== 0 || branch?.opcode !== OP_IF) return false;
  return protocol?.data !== undefined && toHex(protocol.data) === PROTOCOL_ID;
}

/* Where each envelope's pushes start: right after its opening marker. */
function envelopeStarts(steps: readonly Instruction[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < steps.length; i += 1) {
    if (opensEnvelope(steps, i)) starts.push(i + 3);
  }
  return starts;
}

/* Join the body chunks and keep the readings only when the body fits the cap. */
function bodyReading(chunks: readonly Uint8Array[]): Pick<Inscription, "size" | "hex" | "text"> {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (size === 0 || size > MAX_INSCRIPTION_BYTES) return { size };
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const text = decodeText(body);
  return { size, hex: toHex(body), ...(text === undefined ? {} : { text }) };
}

/* A field value as one printable line; a MIME type with a tab or a line break is no MIME type. */
function fieldLine(value: Uint8Array): string | undefined {
  const text = decodeText(value);
  return text === undefined || /[\t\n]/.test(text) ? undefined : text;
}

/* The first value a field tag carries, read as a line; ord keeps the first of duplicate fields. */
function fieldText(fields: readonly Uint8Array[], tag: string): string | undefined {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key && value && toHex(key) === tag) return fieldLine(value);
  }
  return undefined;
}

/*
 * Split envelope pushes the way ord does: tag and value pairs up to the first empty push in a tag
 * position, then every push after it is one chunk of the body.
 */
function readEnvelope(pushes: readonly Uint8Array[], input: number): Inscription {
  const bodyTag = pushes.findIndex((push, index) => index % 2 === 0 && push.length === 0);
  const fields = bodyTag === -1 ? pushes : pushes.slice(0, bodyTag);
  const body = bodyTag === -1 ? [] : pushes.slice(bodyTag + 1);
  const contentType = fieldText(fields, CONTENT_TYPE_TAG);
  const contentEncoding = fieldText(fields, CONTENT_ENCODING_TAG);
  return {
    input,
    ...(contentType === undefined ? {} : { contentType }),
    ...(contentEncoding === undefined ? {} : { contentEncoding }),
    ...bodyReading(body),
  };
}

/* Every envelope in one input's tapscript, in script order. */
function inputInscriptions(witness: readonly string[], input: number): Inscription[] {
  const scriptHex = tapscript(witness);
  if (!scriptHex?.toLowerCase().includes(PROTOCOL_ID)) return [];
  const script = hexToBytes(scriptHex);
  if (!script) return [];

  const steps = instructions(script, 0);
  return envelopeStarts(steps).flatMap((start) => {
    const pushes = envelopePushes(steps, start);
    return pushes ? [readEnvelope(pushes, input)] : [];
  });
}

/**
 * Read the Ordinals inscriptions a transaction reveals in its input witnesses.
 *
 * Each input's tapscript is searched for `OP_FALSE OP_IF "ord" … OP_ENDIF` envelopes, the way the
 * ord reference implementation reads them, so no indexer is involved and nothing is numbered.
 *
 * @param witnesses - Witness stack of each input as hex items, in input order.
 * @returns {Inscription[] | undefined} The inscriptions, or `undefined` when no input carries one.
 */
export function collectInscriptions(
  witnesses: readonly (readonly string[] | undefined)[],
): Inscription[] | undefined {
  const found = witnesses.flatMap((witness, input) =>
    witness ? inputInscriptions(witness, input) : [],
  );
  return found.length > 0 ? found : undefined;
}
