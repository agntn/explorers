import { ARIO_GATEWAY_URL } from "../core/endpoints.ts";
import { Arweave } from "./arweave.ts";

/** Arweave through ar-io.dev, the AR.IO team's own gateway, with older data items Turbo lacks. */
export class Ario extends Arweave {
  static override readonly key: string = "ario";
  protected static override readonly gateway: string = ARIO_GATEWAY_URL;
}
