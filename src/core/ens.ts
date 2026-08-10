/**
 * ENS (Ethereum Name Service) resolution
 *
 * Resolves .eth names to addresses via public ENS APIs.
 * No API key, no keccak256 dependency — pure HTTP.
 */

/** Public ENS resolution endpoints (fallback chain) */
const RESOLVERS = [
  (name: string) => `https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`,
  (name: string) => `https://api.ensdata.net/${encodeURIComponent(name)}`,
];

/** Cheap `.eth` shape check. It does not resolve the name or verify ownership. */
export function isEnsName(input: string): boolean {
  const lower = input.toLowerCase().trim();
  return lower.endsWith(".eth") && lower.length > 4;
}

/** Match a 20-byte EVM hex address. This is not a validator for non-EVM chains. */
export function isAddress(input: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(input.trim());
}

/**
 * Resolve an ENS name through public HTTP resolvers.
 *
 * Resolver failures are tried in order and collapse to `null` when every endpoint fails.
 */
export async function resolveEns(name: string): Promise<string | null> {
  const normalized = name.toLowerCase().trim();

  for (const buildUrl of RESOLVERS) {
    const url = buildUrl(normalized);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!res.ok) continue;

      const json = (await res.json()) as Record<string, unknown>;
      const address = json.address as string | undefined;

      if (address && /^0x[0-9a-fA-F]{40}$/.test(address)) {
        return address;
      }
    } catch {
      // Try next resolver
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}
