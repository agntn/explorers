/** Bounds the tool schemas and executors share. No imports, so `tools.ts` loads nothing heavy. */

/** Holdings one tokens call lists unless asked for more; a busy wallet holds thousands. */
export const TOKEN_HOLDINGS_LIMIT = 50;

/** Outputs one utxos call lists unless asked for more; a dusted address holds thousands. */
export const UNSPENT_OUTPUTS_LIMIT = 50;

/** Transactions or transfers one history call lists unless asked for more. */
export const HISTORY_LIMIT = 10;

/** Most rows any listing hands back in one call. */
export const MAX_LIMIT = 100;

/** Most addresses one balance call reads. */
export const MAX_ADDRESS_BATCH = 20;
