//! Medians for the Clamp Index (spec 6.1 and 6.2, steps 3 to 6).
//!
//! All prices are micro-USD per GPU-hour (`u64`). Weights are small integers.
//! Averages of two values round down.

use super::{MathError, PPM};

/// Average of two values, rounded down, without overflow.
pub fn mean_floor(a: u64, b: u64) -> u64 {
    a / 2 + b / 2 + (a % 2 + b % 2) / 2
}

/// Median of the values, sorting the slice in place. For an even count it is
/// the average of the two middle values, rounded down. `None` when empty.
pub fn median(values: &mut [u64]) -> Option<u64> {
    let n = values.len();
    if n == 0 {
        return None;
    }
    values.sort_unstable();
    if n % 2 == 1 {
        Some(values[n / 2])
    } else {
        Some(mean_floor(values[n / 2 - 1], values[n / 2]))
    }
}

/// Weight of a source from its capacity (spec 6.1).
///
/// Sources without a published capacity use their fixed weight. Otherwise:
/// 0 units gives weight 0 (left out), 1 to 4 units gives 1, 5 or more gives 2.
pub fn source_weight(has_capacity: bool, capacity: u64, fixed_weight: u8) -> u8 {
    if !has_capacity {
        return fixed_weight;
    }
    match capacity {
        0 => 0,
        1..=4 => 1,
        _ => 2,
    }
}

/// One reporter's view of one source, as stored in a report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Sample {
    pub price: u64,
    pub capacity: u64,
}

/// Combine the fresh reports for one source (spec 6.2 step 3).
///
/// Keeps samples whose price is above 0 and inside `[min_price, max_price]`.
/// Returns `None` when fewer than `min_reporters` samples remain (the source is
/// left out). Otherwise returns the median price and the median capacity of
/// the kept samples. At most `MAX_SAMPLES` samples are read.
pub fn combine_source(
    samples: &[Sample],
    min_price: u64,
    max_price: u64,
    min_reporters: u8,
) -> Option<Sample> {
    let mut prices = [0u64; MAX_SAMPLES];
    let mut capacities = [0u64; MAX_SAMPLES];
    let mut n = 0usize;
    for s in samples.iter().take(MAX_SAMPLES) {
        if s.price > 0 && s.price >= min_price && s.price <= max_price {
            prices[n] = s.price;
            capacities[n] = s.capacity;
            n += 1;
        }
    }
    if n == 0 || n < usize::from(min_reporters) {
        return None;
    }
    Some(Sample {
        price: median(&mut prices[..n])?,
        capacity: median(&mut capacities[..n])?,
    })
}

/// Most samples per source, equal to the most reporters per class.
pub const MAX_SAMPLES: usize = 5;

/// A source ready for the weighted median.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Weighted {
    pub price: u64,
    pub weight: u8,
}

/// Weighted median (spec 6.2 step 5), sorting the slice in place.
///
/// Entries with weight 0 are ignored. Walk up the sorted prices until the
/// running weight reaches half of the total. If it hits exactly half, the
/// result is the average of that price and the next one (rounded down).
/// `None` when the total weight is 0.
pub fn weighted_median(entries: &mut [Weighted]) -> Option<u64> {
    entries.sort_unstable_by_key(|e| e.price);
    let total: u64 = entries.iter().map(|e| u64::from(e.weight)).sum();
    if total == 0 {
        return None;
    }
    let mut running: u64 = 0;
    for (i, e) in entries.iter().enumerate() {
        if e.weight == 0 {
            continue;
        }
        running += u64::from(e.weight);
        if running * 2 == total {
            let next = entries[i + 1..].iter().find(|n| n.weight > 0)?;
            return Some(mean_floor(e.price, next.price));
        }
        if running * 2 > total {
            return Some(e.price);
        }
    }
    None
}

/// Step limit (spec 6.2 step 6).
///
/// Clamps `candidate` to `[last * (1 - max_step), last * (1 + max_step)]`.
/// The lower bound rounds up and the upper bound rounds down, so the result
/// never moves more than `max_step_ppm` from `last`. With no previous price
/// (`last == 0`) the candidate passes unchanged.
pub fn apply_step_limit(candidate: u64, last: u64, max_step_ppm: u64) -> Result<u64, MathError> {
    if last == 0 {
        return Ok(candidate);
    }
    if max_step_ppm > PPM {
        return Err(MathError::InvalidInput);
    }
    let last = u128::from(last);
    let ppm = u128::from(PPM);
    let step = u128::from(max_step_ppm);
    let lo = (last * (ppm - step)).div_ceil(ppm);
    let hi = last * (ppm + step) / ppm;
    let clamped = u128::from(candidate).clamp(lo, hi);
    u64::try_from(clamped).map_err(|_| MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(price: u64, weight: u8) -> Weighted {
        Weighted { price, weight }
    }

    fn s(price: u64, capacity: u64) -> Sample {
        Sample { price, capacity }
    }

    #[test]
    fn mean_floor_rounds_down_and_never_overflows() {
        assert_eq!(mean_floor(3, 4), 3);
        assert_eq!(mean_floor(4, 4), 4);
        assert_eq!(mean_floor(u64::MAX, u64::MAX), u64::MAX);
        assert_eq!(mean_floor(u64::MAX, u64::MAX - 1), u64::MAX - 1);
        assert_eq!(mean_floor(0, 1), 0);
    }

    #[test]
    fn median_odd_even_and_empty() {
        assert_eq!(median(&mut []), None);
        assert_eq!(median(&mut [7]), Some(7));
        assert_eq!(median(&mut [9, 1, 5]), Some(5));
        assert_eq!(median(&mut [400_000, 300_000]), Some(350_000));
        assert_eq!(median(&mut [1, 2, 3, 4]), Some(2));
    }

    #[test]
    fn source_weight_tiers() {
        assert_eq!(source_weight(true, 0, 9), 0);
        assert_eq!(source_weight(true, 1, 9), 1);
        assert_eq!(source_weight(true, 4, 9), 1);
        assert_eq!(source_weight(true, 5, 9), 2);
        assert_eq!(source_weight(true, u64::MAX, 9), 2);
        assert_eq!(source_weight(false, 0, 2), 2);
        assert_eq!(source_weight(false, 100, 1), 1);
    }

    #[test]
    fn combine_source_filters_and_takes_medians() {
        // bounds $0.05 to $5
        let (lo, hi) = (50_000, 5_000_000);
        let samples = [s(300_000, 40), s(0, 0), s(320_000, 44), s(9_000_000, 1)];
        // 0 and the out-of-bounds price are dropped, two samples remain
        assert_eq!(combine_source(&samples, lo, hi, 2), Some(s(310_000, 42)));
        assert_eq!(combine_source(&samples, lo, hi, 3), None);
        assert_eq!(combine_source(&[], lo, hi, 1), None);
        assert_eq!(combine_source(&[s(0, 5)], lo, hi, 0), None);
        // bounds are inclusive
        assert_eq!(combine_source(&[s(lo, 1)], lo, hi, 1), Some(s(lo, 1)));
        assert_eq!(combine_source(&[s(hi, 1)], lo, hi, 1), Some(s(hi, 1)));
        assert_eq!(combine_source(&[s(lo - 1, 1)], lo, hi, 1), None);
    }

    #[test]
    fn combine_source_reads_at_most_max_samples() {
        let samples = [s(100_000, 1); MAX_SAMPLES + 3];
        assert_eq!(
            combine_source(&samples, 1, u64::MAX, 1),
            Some(s(100_000, 1))
        );
    }

    #[test]
    fn weighted_median_examples() {
        assert_eq!(weighted_median(&mut []), None);
        assert_eq!(weighted_median(&mut [w(5, 0), w(6, 0)]), None);
        // single source
        assert_eq!(weighted_median(&mut [w(340_000, 2)]), Some(340_000));
        // weights 2, 2, 1, 1 (total 6): running 2 then 4 > 3, so the second price
        assert_eq!(
            weighted_median(&mut [w(450_000, 1), w(300_000, 2), w(340_000, 2), w(400_000, 1)]),
            Some(340_000)
        );
        // weights 1, 1 (total 2): exactly half after the first, average of both
        assert_eq!(
            weighted_median(&mut [w(300_001, 1), w(400_000, 1)]),
            Some(350_000)
        );
        // weight 0 entries never count, even between others
        assert_eq!(
            weighted_median(&mut [w(100, 1), w(200, 0), w(300, 1)]),
            Some(200)
        );
        // one heavy source dominates
        assert_eq!(weighted_median(&mut [w(100, 1), w(500, 2)]), Some(500));
    }

    /// Reference: expand every source into `weight` copies and take the plain median.
    fn naive_weighted_median(entries: &[Weighted]) -> Option<u64> {
        let mut expanded = Vec::new();
        for e in entries {
            for _ in 0..e.weight {
                expanded.push(e.price);
            }
        }
        median(&mut expanded)
    }

    #[test]
    fn weighted_median_matches_expanded_median() {
        // Small deterministic generator, no extra dependency.
        let mut seed: u64 = 0x5eed_c1a3;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..5_000 {
            let n = (next() % 6) as usize + 1;
            let mut entries: Vec<Weighted> = (0..n)
                .map(|_| w(next() % 1_000 + 1, (next() % 3) as u8))
                .collect();
            let expected = naive_weighted_median(&entries);
            assert_eq!(weighted_median(&mut entries), expected, "{entries:?}");
        }
    }

    #[test]
    fn step_limit_clamps_both_ways() {
        let step = 100_000; // 10%
        assert_eq!(apply_step_limit(500_000, 400_000, step), Ok(440_000));
        assert_eq!(apply_step_limit(100_000, 400_000, step), Ok(360_000));
        assert_eq!(apply_step_limit(420_000, 400_000, step), Ok(420_000));
        // no previous price: unchanged
        assert_eq!(apply_step_limit(777, 0, step), Ok(777));
        // zero step freezes the price
        assert_eq!(apply_step_limit(1, 400_000, 0), Ok(400_000));
        // invalid step
        assert_eq!(
            apply_step_limit(1, 400_000, PPM + 1),
            Err(MathError::InvalidInput)
        );
    }

    #[test]
    fn step_limit_rounds_inward() {
        // last = 15, 10%: exact bounds 13.5 and 16.5, so 14 and 16
        assert_eq!(apply_step_limit(0, 15, 100_000), Ok(14));
        assert_eq!(apply_step_limit(100, 15, 100_000), Ok(16));
    }

    #[test]
    fn step_limit_handles_large_values() {
        let last = u64::MAX / 2;
        let up = apply_step_limit(u64::MAX, last, 100_000).unwrap();
        assert!(up > last && up < u64::MAX);
        // the upper bound (2 * last) does not fit in u64, the result still does
        assert_eq!(apply_step_limit(u64::MAX, u64::MAX, PPM), Ok(u64::MAX));
        assert_eq!(apply_step_limit(0, u64::MAX, PPM), Ok(0));
    }
}
