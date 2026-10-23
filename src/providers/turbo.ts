import { TURBO_GATEWAY_URL } from "../core/endpoints.ts";
import { Arweave } from "./arweave.ts";

/** Arweave through Turbo, the AR.IO gateway whose GraphQL index still reaches 2019. */
export class Turbo extends Arweave {
  static override readonly key: string = "turbo";
  protected static override readonly gateway: string = TURBO_GATEWAY_URL;
}
