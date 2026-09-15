export type * from "#shared/wire";

/** The status and message of a failed worker call, for the page. */
export function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const data = error as {
      statusCode?: number;
      statusMessage?: string;
      data?: { statusMessage?: string };
      message?: string;
    };
    const message = data.data?.statusMessage ?? data.statusMessage ?? data.message;
    if (message) {
      return data.statusCode ? `${data.statusCode}: ${message}` : message;
    }
  }
  return String(error);
}

/** The status code of a failed worker call, or null when it didn't get that far. */
export function errorStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}
