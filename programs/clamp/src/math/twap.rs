//! Running sums and the time-weighted period average (spec 6.3).
//!
//! On every accepted update the previous price is counted for the time since
//! the previous update, capped at `max_gap` seconds. Time beyond the cap is not
//! counted, so a stopped oracle never invents a price.

use super::MathError;

/// One stored index update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Observation {
    /// Unix seconds of the update.
    pub ts: i64,
    /// Index price set by this update, micro-USD per GPU-hour.
    pub price: u64,
    /// Sum of `price * counted seconds` up to `ts`.
    pub cum_price: u128,
    /// Sum of counted seconds up to `ts`.
    pub cum_valid: u64,
}

/// Running sums at one moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Sums {
    pub cum_price: u128,
    pub cum_valid: u64,
}

fn counted_secs(from: i64, to: i64, max_gap: i64) -> Result<u64, MathError> {
    if to < from || max_gap < 0 {
        return Err(MathError::InvalidInput);
    }
    let elapsed = to.checked_sub(from).ok_or(MathError::Overflow)?;
    u64::try_from(elapsed.min(max_gap)).map_err(|_| MathError::Overflow)
}

/// The observation stored by an accepted update at time `t` with `price`.
///
/// The first update of a class (`prev == None`) starts both sums at 0. Later
/// updates add `prev.price * min(t - prev.ts, max_gap)` and the counted time.
pub fn next_observation(
    prev: Option<&Observation>,
    t: i64,
    price: u64,
    max_gap: i64,
) -> Result<Observation, MathError> {
    let Some(prev) = prev else {
        return Ok(Observation {
            ts: t,
            price,
            cum_price: 0,
            cum_valid: 0,
        });
    };
    let counted = counted_secs(prev.ts, t, max_gap)?;
    let added = u128::from(prev.price)
        .checked_mul(u128::from(counted))
        .ok_or(MathError::Overflow)?;
    Ok(Observation {
        ts: t,
        price,
        cum_price: prev
            .cum_price
            .checked_add(added)
            .ok_or(MathError::Overflow)?,
        cum_valid: prev
            .cum_valid
            .checked_add(counted)
            .ok_or(MathError::Overflow)?,
    })
}

/// Running sums at time `x`, from the last observation `a` with `a.ts <= x`.
pub fn sums_at(a: &Observation, x: i64, max_gap: i64) -> Result<Sums, MathError> {
    let counted = counted_secs(a.ts, x, max_gap)?;
    let added = u128::from(a.price)
        .checked_mul(u128::from(counted))
        .ok_or(MathError::Overflow)?;
    Ok(Sums {
        cum_price: a.cum_price.checked_add(added).ok_or(MathError::Overflow)?,
        cum_valid: a
            .cum_valid
            .checked_add(counted)
            .ok_or(MathError::Overflow)?,
    })
}

/// Time-weighted average between two moments, rounded down.
///
/// `Ok(None)` when no time was counted in between (the oracle was down for the
/// whole range), so the caller decides what an empty period means.
pub fn average(start: &Sums, end: &Sums) -> Result<Option<u64>, MathError> {
    let valid = end
        .cum_valid
        .checked_sub(start.cum_valid)
        .ok_or(MathError::InvalidInput)?;
    if valid == 0 {
        return Ok(None);
    }
    let total = end
        .cum_price
        .checked_sub(start.cum_price)
        .ok_or(MathError::InvalidInput)?;
    let avg = total / u128::from(valid);
    u64::try_from(avg)
        .map(Some)
        .map_err(|_| MathError::Overflow)
}

/// Seconds counted between two moments (used for coverage checks).
pub fn counted_between(start: &Sums, end: &Sums) -> Result<u64, MathError> {
    end.cum_valid
        .checked_sub(start.cum_valid)
        .ok_or(MathError::InvalidInput)
}

/// Physical slot of the oldest entry in a ring that holds `count` entries
/// with the newest at slot `newest`.
fn oldest_slot(capacity: usize, newest: usize, count: usize) -> usize {
    (newest + capacity + 1 - count) % capacity
}

/// Find the last observation with `ts <= x` in a ring buffer.
///
/// `ring` is the full buffer, `newest` the slot of the newest entry and
/// `count` how many entries are filled (entries are in time order from the
/// oldest to the newest, wrapping around). Returns the physical slot, or
/// `None` when the ring is empty or `x` is before the oldest stored entry.
pub fn find_at_or_before(
    ring: &[Observation],
    newest: usize,
    count: usize,
    x: i64,
) -> Option<usize> {
    let capacity = ring.len();
    if count == 0 || capacity == 0 || count > capacity || newest >= capacity {
        return None;
    }
    let oldest = oldest_slot(capacity, newest, count);
    let slot = |logical: usize| (oldest + logical) % capacity;
    if ring[slot(0)].ts > x {
        return None;
    }
    // Largest logical index with ts <= x. Invariant: ts(lo) <= x.
    let (mut lo, mut hi) = (0usize, count - 1);
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if ring[slot(mid)].ts <= x {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    Some(slot(lo))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX_GAP: i64 = 7_200;

    fn obs(ts: i64, price: u64, cum_price: u128, cum_valid: u64) -> Observation {
        Observation {
            ts,
            price,
            cum_price,
            cum_valid,
        }
    }

    #[test]
    fn first_update_starts_sums_at_zero() {
        let o = next_observation(None, 1_000, 340_000, MAX_GAP).unwrap();
        assert_eq!(o, obs(1_000, 340_000, 0, 0));
    }

    #[test]
    fn next_observation_counts_previous_price() {
        let a = obs(1_000, 300_000, 0, 0);
        let b = next_observation(Some(&a), 1_900, 330_000, MAX_GAP).unwrap();
        assert_eq!(b, obs(1_900, 330_000, 300_000 * 900, 900));
    }

    #[test]
    fn gap_beyond_max_is_not_counted() {
        let a = obs(0, 300_000, 0, 0);
        let b = next_observation(Some(&a), 100_000, 310_000, MAX_GAP).unwrap();
        assert_eq!(b.cum_valid, 7_200);
        assert_eq!(b.cum_price, 300_000 * 7_200);
    }

    #[test]
    fn time_going_backwards_is_rejected() {
        let a = obs(1_000, 1, 0, 0);
        assert_eq!(
            next_observation(Some(&a), 999, 1, MAX_GAP),
            Err(MathError::InvalidInput)
        );
        assert_eq!(sums_at(&a, 999, MAX_GAP), Err(MathError::InvalidInput));
        assert_eq!(
            next_observation(Some(&a), 2_000, 1, -1),
            Err(MathError::InvalidInput)
        );
    }

    #[test]
    fn same_timestamp_adds_nothing() {
        let a = obs(1_000, 5, 10, 2);
        let b = next_observation(Some(&a), 1_000, 6, MAX_GAP).unwrap();
        assert_eq!(b, obs(1_000, 6, 10, 2));
    }

    #[test]
    fn sums_at_extrapolates_and_caps() {
        let a = obs(1_000, 400_000, 50, 7);
        assert_eq!(
            sums_at(&a, 1_600, MAX_GAP).unwrap(),
            Sums {
                cum_price: 50 + 400_000 * 600,
                cum_valid: 7 + 600
            }
        );
        assert_eq!(
            sums_at(&a, 1_000 + 50_000, MAX_GAP).unwrap().cum_valid,
            7 + 7_200
        );
    }

    #[test]
    fn overflow_is_reported_not_wrapped() {
        let a = obs(0, u64::MAX, u128::MAX - 1, 0);
        assert_eq!(
            next_observation(Some(&a), 10, 1, MAX_GAP),
            Err(MathError::Overflow)
        );
        let b = obs(0, 1, 0, u64::MAX);
        assert_eq!(sums_at(&b, 10, MAX_GAP), Err(MathError::Overflow));
    }

    /// A one-hour period: $0.30 for 30 min, $0.40 for 20 min, $0.50 for 10 min.
    #[test]
    fn average_over_a_period() {
        let t0 = 10_000;
        let o1 = next_observation(None, t0, 300_000, MAX_GAP).unwrap();
        let o2 = next_observation(Some(&o1), t0 + 1_800, 400_000, MAX_GAP).unwrap();
        let o3 = next_observation(Some(&o2), t0 + 3_000, 500_000, MAX_GAP).unwrap();
        let start = sums_at(&o1, t0, MAX_GAP).unwrap();
        let end = sums_at(&o3, t0 + 3_600, MAX_GAP).unwrap();
        // (0.30*30 + 0.40*20 + 0.50*10) / 60 = 0.3666... -> 366_666
        assert_eq!(average(&start, &end).unwrap(), Some(366_666));
        assert_eq!(counted_between(&start, &end).unwrap(), 3_600);
    }

    #[test]
    fn average_skips_uncounted_downtime() {
        // $0.30 for 1 h, then the oracle is down 10 h, then $0.60 for 1 h.
        let o1 = next_observation(None, 0, 300_000, MAX_GAP).unwrap();
        let o2 = next_observation(Some(&o1), 3_600 + 36_000, 600_000, MAX_GAP).unwrap();
        let start = sums_at(&o1, 0, MAX_GAP).unwrap();
        let end = sums_at(&o2, 3_600 + 36_000 + 3_600, MAX_GAP).unwrap();
        // counted: 7_200 s at 0.30 (1 h real + 1 h allowed gap) and 3_600 s at 0.60
        assert_eq!(counted_between(&start, &end).unwrap(), 10_800);
        assert_eq!(average(&start, &end).unwrap(), Some(400_000));
    }

    #[test]
    fn average_of_empty_range_is_none() {
        let s = Sums {
            cum_price: 5,
            cum_valid: 9,
        };
        assert_eq!(average(&s, &s), Ok(None));
    }

    #[test]
    fn average_rejects_reversed_range() {
        let a = Sums {
            cum_price: 10,
            cum_valid: 10,
        };
        let b = Sums {
            cum_price: 5,
            cum_valid: 20,
        };
        assert_eq!(average(&b, &a), Err(MathError::InvalidInput));
        assert_eq!(average(&a, &b), Err(MathError::InvalidInput));
    }

    fn ring_with(capacity: usize, timestamps: &[i64]) -> (Vec<Observation>, usize, usize) {
        let mut ring = vec![Observation::default(); capacity];
        let mut newest = capacity - 1;
        let mut count = 0;
        for &ts in timestamps {
            newest = (newest + 1) % capacity;
            ring[newest] = obs(ts, ts as u64, 0, 0);
            count = (count + 1).min(capacity);
        }
        (ring, newest, count)
    }

    #[test]
    fn find_in_ring_without_wrap() {
        let (ring, newest, count) = ring_with(8, &[100, 200, 300]);
        let at = |x| find_at_or_before(&ring, newest, count, x).map(|i| ring[i].ts);
        assert_eq!(at(99), None);
        assert_eq!(at(100), Some(100));
        assert_eq!(at(250), Some(200));
        assert_eq!(at(300), Some(300));
        assert_eq!(at(10_000), Some(300));
    }

    #[test]
    fn find_in_wrapped_ring() {
        // capacity 4, seven writes: the ring keeps 400, 500, 600, 700
        let (ring, newest, count) = ring_with(4, &[100, 200, 300, 400, 500, 600, 700]);
        assert_eq!(count, 4);
        let at = |x| find_at_or_before(&ring, newest, count, x).map(|i| ring[i].ts);
        assert_eq!(at(399), None);
        assert_eq!(at(400), Some(400));
        assert_eq!(at(650), Some(600));
        assert_eq!(at(700), Some(700));
        assert_eq!(at(i64::MAX), Some(700));
    }

    #[test]
    fn find_matches_linear_scan_for_every_ring_state() {
        let capacity = 5;
        let timestamps: Vec<i64> = (1..=13).map(|i| i * 10).collect();
        for writes in 1..=timestamps.len() {
            let (ring, newest, count) = ring_with(capacity, &timestamps[..writes]);
            let kept = &timestamps[writes.saturating_sub(capacity)..writes];
            for x in 0..=140 {
                let expected = kept.iter().rev().find(|&&t| t <= x).copied();
                let got = find_at_or_before(&ring, newest, count, x).map(|i| ring[i].ts);
                assert_eq!(got, expected, "writes {writes}, x {x}");
            }
        }
    }

    #[test]
    fn find_rejects_bad_ring_state() {
        let ring = vec![Observation::default(); 4];
        assert_eq!(find_at_or_before(&ring, 0, 0, 5), None);
        assert_eq!(find_at_or_before(&ring, 0, 5, 5), None);
        assert_eq!(find_at_or_before(&ring, 4, 1, 5), None);
        assert_eq!(find_at_or_before(&[], 0, 1, 5), None);
    }
}
