// Typed access to the clamp program through its generated IDL.

import {
  AnchorProvider,
  BorshCoder,
  EventParser,
  Program,
  convertIdlToCamelCase,
  type Idl,
  type Wallet,
} from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

import idlJson from "./idl/clamp.json" with { type: "json" };
import type { Clamp } from "./idl/clamp.js";

export type { Clamp };
/** The IDL exactly as Anchor wrote it (snake_case fields, PascalCase types). */
export const CLAMP_IDL_JSON = idlJson as Idl;
/** The same IDL with camelCase names, matching the generated `Clamp` type. */
export const CLAMP_IDL = convertIdlToCamelCase(CLAMP_IDL_JSON) as unknown as Clamp;

/** A wallet that cannot sign, for read-only programs. */
class ReadOnlyWallet implements Wallet {
  readonly payer = Keypair.generate();
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
    throw new Error("read-only wallet cannot sign");
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(_txs: T[]): Promise<T[]> {
    throw new Error("read-only wallet cannot sign");
  }
}

/** Program client. Pass a wallet to send transactions, or none to only read. */
export function clampProgram(connection: Connection, wallet?: Wallet): Program<Clamp> {
  const provider = new AnchorProvider(connection, wallet ?? new ReadOnlyWallet(), {
    commitment: "confirmed",
  });
  return new Program<Clamp>(CLAMP_IDL_JSON as unknown as Clamp, provider);
}

/** Decodes clamp events from transaction logs. */
export function clampEventParser(programId: PublicKey = new PublicKey(CLAMP_IDL.address)) {
  return new EventParser(programId, new BorshCoder(CLAMP_IDL as unknown as Idl));
}
