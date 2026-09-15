/** The longest real identifier, a Cardano address, is 103 characters. */
export const IDENTIFIER_MAX = 128;

/**
 * An address, an ENS name or a hash as the chains spell them: letters, digits, dots, dashes,
 * underscores and colons. Nothing that could be a path, a query or markup. The page checks it
 * before a request goes out and the worker checks it again.
 */
export function isIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= IDENTIFIER_MAX &&
    /^[\w.:-]+$/u.test(value) &&
    value !== "." &&
    value !== ".."
  );
}
