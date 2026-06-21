/**
 * Numeric helpers for wei/ETH conversions.
 *
 * Kept separate from `core/types.ts` because wei/decimal conversion is a
 * numeric concern, not a domain-model concern, and lives on the I/O boundary
 * where IEEE754-floated upstream values (e.g. Blockchair's `data.value`
 * returned as a JS number) must be turned back into exact wei.
 */

/**
 * Convert a decimal ETH amount (string or number, e.g. "0.5" or 0.5)
 * to a wei BigInt string without floating-point precision loss.
 *
 * `Number(0.5) * 1e18` happens to give `5e17` exactly, but the same
 * expression for `0.1` gives `100000000000000005.5...` — every cent of
 * ETH wei drifts. Splitting on `.`, padding to 18 fractional digits, and
 * using BigInt preserves the upstream value verbatim.
 *
 * @throws if input is not a valid decimal number, or has >18 fractional digits.
 */
export function decimalToWei(value: string | number): string {
  const s = String(value).trim()
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`decimalToWei: not a valid decimal: ${value}`)
  }
  const negative = s.startsWith('-')
  const abs = negative ? s.slice(1) : s
  const [intPart, fracPart = ''] = abs.split('.')
  if (fracPart.length > 18) {
    throw new Error(`decimalToWei: more than 18 fractional digits: ${value}`)
  }
  const padded = (fracPart + '0'.repeat(18)).slice(0, 18)
  const wei = BigInt(intPart ?? '0') * 10n ** 18n + BigInt(padded || '0')
  return (negative ? '-' : '') + wei.toString()
}
