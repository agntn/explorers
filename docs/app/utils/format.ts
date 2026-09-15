/** `2024-01-20T14:25:10.000Z` → `2024-01-20`. */
export function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/** `2024-01-20T14:25:10.000Z` → `2024-01-20 14:25`. */
export function dateTime(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "";
}

/** `12 s ago`, `3 min ago`, `2 h ago`, `4 d ago`; the full timestamp belongs in a title. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Bytes as kB or MB with one decimal. */
export function bytes(value: number | null): string {
  if (value === null) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} kB`;
  return `${value} B`;
}

/** Cuts a text at `max` code points with an ellipsis. */
export function clip(value: string, max: number): string {
  const points = [...value];
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : value;
}

/** An address or a hash shortened to its ends: `0x1f98…f984`. */
export function shortHash(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

/** Thousands separators for an integer string without going through a float. */
export function groupDigits(value: string): string {
  const [whole = "", fraction] = value.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

/** A formatted amount trimmed to `places` fractional digits, without rounding, so nothing is invented. */
export function trimDecimals(value: string, places: number): string {
  const [whole = "0", fraction] = value.split(".");
  if (!fraction || places <= 0) return whole;
  const cut = fraction.slice(0, places).replace(/0+$/u, "");
  return cut ? `${whole}.${cut}` : whole;
}

/**
 * An integer string in the smallest unit as a decimal, the way the library's `formatWei()` does
 * it. A copy on purpose: the library entry pulls `ofetch` and `@agntn/chains` into the browser
 * bundle, and the page only ever needs this one shift.
 */
export function formatUnits(value: string, decimals: number): string {
  if (!/^-?\d+$/u.test(value)) return value;
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Host and path for display, without the scheme or the query: `api.etherscan.io/v2/api`. */
export function hostPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname.replace(/\/$/u, "")}`;
  } catch {
    return url;
  }
}

/** The badge class for a transaction status; every list and card uses the same three. */
export function statusClass(status: string): string {
  if (status === "success") return "explorers-state-ok";
  if (status === "failed") return "explorers-state-failed";
  return "explorers-state-warn";
}

/**
 * Border classes for cell `index` in a grid that's two columns on phones and `sm`/`lg` columns
 * above; the borders sit on the cells so rounded corners stay clean.
 */
export function cellBorders(index: number, sm: number, lg = sm): Record<string, boolean> {
  return {
    "border-t": index >= 2,
    "sm:border-t-0": index < sm,
    "lg:border-t-0": index < lg,
    "border-l": index % 2 === 1,
    "sm:border-l": index % sm !== 0,
    "sm:border-l-0": index % sm === 0,
    "lg:border-l": index % lg !== 0,
    "lg:border-l-0!": index % lg === 0,
  };
}
