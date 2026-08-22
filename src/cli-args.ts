/** CLI argument normalization — default to 'balance' subcommand */

const SUBCOMMANDS = [
  "balance",
  "tx",
  "contract",
  "tokens",
  "transfers",
  "gas",
  "block",
  "providers",
  "mcp",
];

export function normalizeMainArgs(argv: string[]): string[] {
  if (argv.length === 0) return ["providers"];

  const first = argv[0]!;
  // If first arg is already a known subcommand, pass through
  if (
    SUBCOMMANDS.includes(first) ||
    first === "--help" ||
    first === "-h" ||
    first === "--version" ||
    first === "-v"
  ) {
    return argv;
  }

  // Treat as address — default to 'balance'
  return ["balance", ...argv];
}
