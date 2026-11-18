// Claims 1,000 tUSDC from the devnet faucet for a local keypair (testing).
//   pnpm --filter @clamp/backend faucet-claim <keypair file in ~/.config/solana/clamp/>

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { TEST_USDC_PROGRAM_ID } from "@clamp/sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const TUSDC_MINT = new PublicKey("7Cy32ram7nmVKVzty5Bw1Px3t9Dp2cTjXC1PmbEJdt4L");
// sha256("global:claim")[0..8], the Anchor discriminator of `claim`
const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: faucet-claim <keypair file>");
  const bytes = JSON.parse(readFileSync(join(homedir(), ".config", "solana", "clamp", file), "utf8")) as number[];
  const user = Keypair.fromSecretKey(Uint8Array.from(bytes));
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, TEST_USDC_PROGRAM_ID)[0];
  const ata = getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey);
  const keys = [
    { pubkey: user.publicKey, isSigner: true, isWritable: true },
    { pubkey: pda([Buffer.from("faucet"), user.publicKey.toBuffer()]), isSigner: false, isWritable: true },
    { pubkey: TUSDC_MINT, isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("mint_authority")]), isSigner: false, isWritable: false },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: TEST_USDC_PROGRAM_ID, keys, data: CLAIM_DISCRIMINATOR });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [user], { commitment: "confirmed" });
  const account = await getAccount(connection, ata, "confirmed");
  console.log(`claimed: ${sig}`);
  console.log(`${user.publicKey.toBase58()} holds ${Number(account.amount) / 1e6} tUSDC`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
