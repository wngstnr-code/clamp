// GPU classes: which sources feed each class, in report slot order, with the
// request a reporter sends and the rule that turns the answer into a price.
// The on-chain ClassConfig is created from these values (set_class).

import {
  CLASS_H100,
  CLASS_RTX4090,
  SOURCE_AKASH,
  SOURCE_NOSANA,
  SOURCE_RUNPOD,
  SOURCE_VAST,
} from "../constants.js";
import {
  AKASH_REQUEST,
  NOSANA_REQUEST,
  RUNPOD_REQUEST,
  akashRule,
  nosanaRule,
  runpodRule,
  vastRequest,
  vastRule,
  type SourceRequest,
  type SourceResult,
} from "./rules.js";

export interface ClassSource {
  sourceId: number;
  hasCapacity: boolean;
  fixedWeight: number;
  request: SourceRequest;
  rule: (raw: string) => SourceResult;
  /** What exactly is read, for the index page. */
  description: string;
}

export interface ClassSpec {
  classId: number;
  name: string;
  /** Report slot i = sources[i]. Fixed once the class exists on-chain. */
  sources: ClassSource[];
  minSources: number;
  minTotalWeight: number;
  /** Sanity bounds, micro-USD per GPU-hour. */
  minPrice: bigint;
  maxPrice: bigint;
  maxStepPpm: number;
  /** Daily, weekly, monthly. */
  halfWidthPpm: [number, number, number];
}

export const RTX4090: ClassSpec = {
  classId: CLASS_RTX4090,
  name: "RTX 4090",
  sources: [
    {
      sourceId: SOURCE_VAST,
      hasCapacity: true,
      fixedWeight: 0,
      request: vastRequest("RTX 4090"),
      rule: (raw) => vastRule(raw, "RTX 4090"),
      description: "Median dph_total of rentable, verified, on-demand, single-GPU RTX 4090 offers",
    },
    {
      sourceId: SOURCE_RUNPOD,
      hasCapacity: false,
      fixedWeight: 2,
      request: RUNPOD_REQUEST,
      rule: (raw) => runpodRule(raw, "NVIDIA GeForce RTX 4090"),
      description: "communityPrice of NVIDIA GeForce RTX 4090",
    },
    {
      sourceId: SOURCE_AKASH,
      hasCapacity: true,
      fixedWeight: 0,
      request: AKASH_REQUEST,
      rule: (raw) => akashRule(raw, "rtx4090"),
      description: "price.weightedAverage of the rtx4090 model, capacity availability.available",
    },
    {
      sourceId: SOURCE_NOSANA,
      hasCapacity: false,
      fixedWeight: 1,
      request: NOSANA_REQUEST,
      rule: (raw) => nosanaRule(raw, "4090"),
      description: "Median usd_reward_per_hour of the markets whose name contains 4090",
    },
  ],
  minSources: 2,
  minTotalWeight: 3,
  minPrice: 50_000n,
  maxPrice: 5_000_000n,
  maxStepPpm: 100_000,
  halfWidthPpm: [200_000, 200_000, 250_000],
};

/** H100 SXM only, plus the Nosana H100 markets (D-053). */
export const H100: ClassSpec = {
  classId: CLASS_H100,
  name: "H100",
  sources: [
    {
      sourceId: SOURCE_VAST,
      hasCapacity: true,
      fixedWeight: 0,
      request: vastRequest("H100 SXM"),
      rule: (raw) => vastRule(raw, "H100 SXM"),
      description: "Median dph_total of rentable, verified, on-demand, single-GPU H100 SXM offers",
    },
    {
      sourceId: SOURCE_RUNPOD,
      hasCapacity: false,
      fixedWeight: 2,
      request: RUNPOD_REQUEST,
      rule: (raw) => runpodRule(raw, "NVIDIA H100 80GB HBM3"),
      description: "communityPrice of NVIDIA H100 80GB HBM3 (SXM)",
    },
    {
      sourceId: SOURCE_AKASH,
      hasCapacity: true,
      fixedWeight: 0,
      request: AKASH_REQUEST,
      rule: (raw) => akashRule(raw, "h100", "SXM5"),
      description: "price.weightedAverage of the h100 SXM5 model, capacity availability.available",
    },
    {
      sourceId: SOURCE_NOSANA,
      hasCapacity: false,
      fixedWeight: 1,
      request: NOSANA_REQUEST,
      rule: (raw) => nosanaRule(raw, "H100"),
      description: "Median usd_reward_per_hour of the markets whose name contains H100",
    },
  ],
  minSources: 2,
  minTotalWeight: 3,
  minPrice: 500_000n,
  maxPrice: 20_000_000n,
  maxStepPpm: 100_000,
  halfWidthPpm: [200_000, 200_000, 250_000],
};

export const CLASSES: Record<number, ClassSpec> = {
  [CLASS_RTX4090]: RTX4090,
  [CLASS_H100]: H100,
};

export function classSpec(classId: number): ClassSpec {
  const spec = CLASSES[classId];
  if (!spec) throw new Error(`unknown class ${classId}`);
  return spec;
}
