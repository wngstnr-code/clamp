import { PublicKey } from "@solana/web3.js";

/** Program ids (devnet). See docs/build-and-deploy.md section 3. */
export const CLAMP_PROGRAM_ID = new PublicKey("wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC");
export const TEST_USDC_PROGRAM_ID = new PublicKey("5QZihvTBjqZkmbX2gFcQjqnNBBq1AB3W8nRD2VeVUZLP");

/** Fixed protocol values, equal to programs/clamp/src/constants.rs (spec 6.4). */
export const MIN_UPDATE_INTERVAL = 600;
export const MAX_GAP = 7_200;
export const REPORT_WINDOW = 900;
export const REPORT_WAIT = 600;
export const OBS_CARDINALITY = 2_048;
export const MAX_REPORTERS = 5;
export const MAX_SOURCES = 6;

/** 1,000,000 = 100%. Prices are micro-USD per GPU-hour. */
export const PPM = 1_000_000n;
export const MICRO = 1_000_000;

export const CLASS_RTX4090 = 1;
export const CLASS_H100 = 2;

export const SOURCE_VAST = 1;
export const SOURCE_RUNPOD = 2;
export const SOURCE_AKASH = 3;
export const SOURCE_NOSANA = 4;

export const SOURCE_NAMES: Record<number, string> = {
  [SOURCE_VAST]: "Vast.ai",
  [SOURCE_RUNPOD]: "RunPod",
  [SOURCE_AKASH]: "Akash",
  [SOURCE_NOSANA]: "Nosana",
};
