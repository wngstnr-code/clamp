// PDA helpers for docs/architecture.md section 3.2.

import { PublicKey } from "@solana/web3.js";

import { CLAMP_PROGRAM_ID } from "./constants.js";

const pda = (seeds: (Buffer | Uint8Array)[], programId = CLAMP_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export const configPda = (programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("config")], programId);

export const classPda = (classId: number, programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("class"), Uint8Array.of(classId)], programId);

export const indexPda = (classId: number, programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("index"), Uint8Array.of(classId)], programId);
