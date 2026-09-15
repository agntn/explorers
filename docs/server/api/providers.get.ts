import { version } from "@agntn/explorers";
import type { ProvidersAnswer } from "#shared/wire";

/** The providers as the worker sees them; `configured` says whether a read through it can start, nothing more. */
export default defineEventHandler((event): ProvidersAnswer => {
  markPublic(event, TTL.providers);
  return { version, providers: providerStatuses() };
});
