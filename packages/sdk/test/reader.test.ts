// Decoders against the IDL: encode an account with Anchor's coder, decode it
// with the hand-written decoder, compare.

import { BorshCoder, type Idl } from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { decodeIndexState, decodeObservations } from "../src/index-reader.js";
import { CLAMP_IDL } from "../src/program.js";
import { classPda, configPda, indexPda } from "../src/pda.js";
import { CLAMP_PROGRAM_ID, OBS_CARDINALITY } from "../src/constants.js";

const coder = new BorshCoder(CLAMP_IDL as unknown as Idl);

describe("IndexState decoder", () => {
  it("matches the Anchor coder field by field", async () => {
    const observations = Keypair.generate().publicKey;
    const reporter = Keypair.generate().publicKey;
    const report = (i: number) => ({
      reporter: i === 1 ? reporter : PublicKey.default,
      ts: new BN(1_800_000_000 + i),
      used: i === 1,
      prices: [0, 1, 2, 3, 4, 5].map((s) => new BN((i + 1) * 100_000 + s)),
      capacities: [0, 1, 2, 3, 4, 5].map((s) => i * 10 + s),
    });
    const account = {
      classId: 1,
      observations,
      lastTs: new BN(1_800_000_600),
      lastPrice: new BN(363_600),
      cumPrice: new BN("340282366920938463463374607431768211455"), // u128 max
      cumValid: new BN(600),
      obsIndex: 2047,
      obsCount: 2048,
      updateCount: new BN("18446744073709551615"),
      reports: [0, 1, 2, 3, 4].map(report),
      bump: 254,
      reserved: Array(64).fill(0),
    };
    const data = await coder.accounts.encode("indexState", account);
    const v = decodeIndexState(data);
    expect(v.classId).toBe(1);
    expect(v.observations.equals(observations)).toBe(true);
    expect(v.lastTs).toBe(1_800_000_600);
    expect(v.lastPrice).toBe(363_600n);
    expect(v.cumPrice).toBe(2n ** 128n - 1n);
    expect(v.cumValid).toBe(600n);
    expect([v.obsIndex, v.obsCount]).toEqual([2047, 2048]);
    expect(v.updateCount).toBe(2n ** 64n - 1n);
    expect(v.reports[1]!.reporter.equals(reporter)).toBe(true);
    expect(v.reports[1]!.used).toBe(true);
    expect(v.reports[4]!.ts).toBe(1_800_000_004);
    expect(v.reports[4]!.prices).toEqual([500_000n, 500_001n, 500_002n, 500_003n, 500_004n, 500_005n]);
    expect(v.reports[3]!.capacities).toEqual([30, 31, 32, 33, 34, 35]);
  });
});

describe("Observations decoder", () => {
  it("reads 40-byte slots with a split u128", () => {
    const data = new Uint8Array(8 + OBS_CARDINALITY * 40);
    const view = new DataView(data.buffer);
    const put = (slot: number, ts: bigint, price: bigint, cum: bigint, valid: bigint) => {
      const o = 8 + slot * 40;
      view.setBigInt64(o, ts, true);
      view.setBigUint64(o + 8, price, true);
      view.setBigUint64(o + 16, cum & (2n ** 64n - 1n), true);
      view.setBigUint64(o + 24, cum >> 64n, true);
      view.setBigUint64(o + 32, valid, true);
    };
    put(0, 1_800_000_000n, 310_000n, 0n, 0n);
    put(2047, 1_900_000_000n, 2_690_000n, 2n ** 100n + 7n, 1_234n);
    const ring = decodeObservations(data);
    expect(ring).toHaveLength(OBS_CARDINALITY);
    expect(ring[0]).toEqual({ ts: 1_800_000_000, price: 310_000n, cumPrice: 0n, cumValid: 0n });
    expect(ring[2047]).toEqual({ ts: 1_900_000_000, price: 2_690_000n, cumPrice: 2n ** 100n + 7n, cumValid: 1_234n });
  });
});

describe("PDAs", () => {
  it("derive from the documented seeds", () => {
    const find = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, CLAMP_PROGRAM_ID)[0];
    expect(configPda().equals(find([Buffer.from("config")]))).toBe(true);
    expect(classPda(1).equals(find([Buffer.from("class"), Uint8Array.of(1)]))).toBe(true);
    expect(indexPda(2).equals(find([Buffer.from("index"), Uint8Array.of(2)]))).toBe(true);
    expect(classPda(1).equals(classPda(2))).toBe(false);
  });
});

describe("series PDAs", () => {
  it("derive from the documented seeds", async () => {
    const { seriesPda, seriesAccounts } = await import("../src/pda.js");
    const find = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, CLAMP_PROGRAM_ID)[0];
    const s = seriesPda(1, 1, 3);
    expect(s.equals(find([Buffer.from("series"), Uint8Array.of(1), Uint8Array.of(1), Uint8Array.of(3, 0, 0, 0)]))).toBe(true);
    expect(seriesAccounts(s).collateral.equals(find([Buffer.from("collateral"), s.toBuffer()]))).toBe(true);
  });
});
