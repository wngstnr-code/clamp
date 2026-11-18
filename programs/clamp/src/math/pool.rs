//! Pool and series math (spec 8, 10.1, 11). Pure functions.
//!
//! Units: USDC and claims in micro units (`u64`, 1,000,000 = 1 USDC or 1
//! claim), index prices in micro-USD per GPU-hour, fractions in ppm, fees in
//! bps. Rounding favors the series collateral and the vault (spec 5): tokens
//! and USDC out round down, fees and USDC in round up.
//!
//! Functions are written for "side S against side O": a buy or sell of UP uses
//! `(pool_up, pool_down)`, of DOWN uses `(pool_down, pool_up)`.

use super::{MathError, PPM};

/// Lowest and highest pool price the pool trades at (spec 8.6).
pub const P_MIN_PPM: u64 = 20_000;
/// 10,000 basis points = 100%.
pub const BPS_DENOM: u64 = 10_000;

fn to_u64(x: u128) -> Result<u64, MathError> {
    u64::try_from(x).map_err(|_| MathError::Overflow)
}

/// Integer square root, rounded down.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    // Newton's method from a power-of-two upper bound.
    let mut x = 1u128 << ((128 - n.leading_zeros()).div_ceil(2));
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// Integer square root, rounded up.
pub fn isqrt_ceil(n: u128) -> u128 {
    let r = isqrt(n);
    if r * r == n {
        r
    } else {
        r + 1
    }
}

/// Value of one UP claim for an average `avg` (spec 11, also 8.1):
/// `clamp(floor((avg - lower) * 1e6 / (upper - lower)), 0, 1e6)` in ppm.
pub fn band_value_ppm(avg: u64, lower: u64, upper: u64) -> Result<u64, MathError> {
    if lower >= upper {
        return Err(MathError::InvalidInput);
    }
    if avg <= lower {
        return Ok(0);
    }
    if avg >= upper {
        return Ok(PPM);
    }
    let v = u128::from(avg - lower) * u128::from(PPM) / u128::from(upper - lower);
    to_u64(v)
}

/// Projected period average (spec 8.1): the average so far plus the last
/// price for the time that is left. `None` when nothing is counted and no
/// time is left.
pub fn projected_avg(
    counted_price: u128,
    counted_secs: u64,
    last_price: u64,
    remaining_secs: u64,
) -> Result<Option<u64>, MathError> {
    let rest = u128::from(last_price)
        .checked_mul(u128::from(remaining_secs))
        .ok_or(MathError::Overflow)?;
    let num = counted_price.checked_add(rest).ok_or(MathError::Overflow)?;
    let den = u128::from(counted_secs) + u128::from(remaining_secs);
    if den == 0 {
        return Ok(None);
    }
    to_u64(num / den).map(Some)
}

/// `p` limited to `[P_MIN, 1 - P_MIN]`.
pub fn clamp_price(p_ppm: u64) -> u64 {
    p_ppm.clamp(P_MIN_PPM, PPM - P_MIN_PPM)
}

/// True when the fair value is so close to 0 or 1 that the pool pauses.
pub fn pool_paused(v_ppm: u64) -> bool {
    !(P_MIN_PPM..=PPM - P_MIN_PPM).contains(&v_ppm)
}

/// Units of the vault in one series, split between pool and inventory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Holdings {
    pub pool_up: u64,
    pub inv_up: u64,
    pub pool_down: u64,
    pub inv_down: u64,
}

impl Holdings {
    pub fn total_up(&self) -> Result<u64, MathError> {
        self.pool_up
            .checked_add(self.inv_up)
            .ok_or(MathError::Overflow)
    }
    pub fn total_down(&self) -> Result<u64, MathError> {
        self.pool_down
            .checked_add(self.inv_down)
            .ok_or(MathError::Overflow)
    }
}

/// Re-centering (spec 8.2): puts the largest pool with UP price `p` that the
/// vault's units allow, the rest goes to inventory. `p` is clamped to
/// `[P_MIN, 1 - P_MIN]`. Only moves vault units; totals stay equal.
pub fn recenter(h: &Holdings, p_ppm: u64) -> Result<Holdings, MathError> {
    let p = u128::from(clamp_price(p_ppm));
    let ppm = u128::from(PPM);
    let t_up = u128::from(h.total_up()?);
    let t_down = u128::from(h.total_down()?);
    // s = min(T_up / (1 - p), T_down / p)
    let s = (t_up * ppm / (ppm - p)).min(t_down * ppm / p);
    let pool_up = (s * (ppm - p) / ppm).min(t_up);
    let pool_down = (s * p / ppm).min(t_down);
    Ok(Holdings {
        pool_up: to_u64(pool_up)?,
        inv_up: to_u64(t_up - pool_up)?,
        pool_down: to_u64(pool_down)?,
        inv_down: to_u64(t_down - pool_down)?,
    })
}

/// Fee on a USDC amount, rounded up.
pub fn fee_of(usdc: u64, fee_bps: u16) -> Result<u64, MathError> {
    if u64::from(fee_bps) > BPS_DENOM {
        return Err(MathError::InvalidInput);
    }
    to_u64((u128::from(usdc) * u128::from(fee_bps)).div_ceil(u128::from(BPS_DENOM)))
}

/// Splits a fee: the protocol part rounds down, the vault gets the rest.
pub fn split_fee(fee: u64, protocol_share_bps: u16) -> Result<(u64, u64), MathError> {
    if u64::from(protocol_share_bps) > BPS_DENOM {
        return Err(MathError::InvalidInput);
    }
    let protocol =
        to_u64(u128::from(fee) * u128::from(protocol_share_bps) / u128::from(BPS_DENOM))?;
    Ok((fee - protocol, protocol))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuyResult {
    /// Total fee, taken from `usdc_in`.
    pub fee: u64,
    /// Pairs minted into the pool (`usdc_in - fee`).
    pub pairs: u64,
    /// Claims of side S to the buyer.
    pub out: u64,
    pub new_pool_s: u64,
    pub new_pool_o: u64,
}

/// Buy of side S with `usdc_in` (spec 8.3).
pub fn buy(pool_s: u64, pool_o: u64, usdc_in: u64, fee_bps: u16) -> Result<BuyResult, MathError> {
    if pool_s == 0 || pool_o == 0 {
        return Err(MathError::InvalidInput);
    }
    let fee = fee_of(usdc_in, fee_bps)?;
    let x = usdc_in - fee;
    if x == 0 {
        return Err(MathError::InvalidInput);
    }
    let k = u128::from(pool_s) * u128::from(pool_o);
    let new_o = u128::from(pool_o) + u128::from(x);
    let new_s = k.div_ceil(new_o);
    let out = u128::from(pool_s) + u128::from(x) - new_s;
    Ok(BuyResult {
        fee,
        pairs: x,
        out: to_u64(out)?,
        new_pool_s: to_u64(new_s)?,
        new_pool_o: to_u64(new_o)?,
    })
}

/// Claims of side S that `pairs` minted pairs buy, without fee.
fn out_for_pairs(pool_s: u64, pool_o: u64, pairs: u64) -> u128 {
    let k = u128::from(pool_s) * u128::from(pool_o);
    let new_s = k.div_ceil(u128::from(pool_o) + u128::from(pairs));
    u128::from(pool_s) + u128::from(pairs) - new_s
}

/// Smallest `usdc_in` whose buy gives at least `a` claims of side S
/// (spec 8.3 "cost for an exact number of claims", fee included).
pub fn cost_exact_out(pool_s: u64, pool_o: u64, a: u64, fee_bps: u16) -> Result<u64, MathError> {
    if pool_s == 0 || pool_o == 0 || a == 0 || u64::from(fee_bps) >= BPS_DENOM {
        return Err(MathError::InvalidInput);
    }
    let (s, o, a128) = (u128::from(pool_s), u128::from(pool_o), u128::from(a));
    // x = (-(S + O - a) + sqrt((S + O - a)^2 + 4 a O)) / 2, rounded up. S + O - a may be negative.
    let b = (s + o) as i128 - a128 as i128;
    let disc = b
        .checked_mul(b)
        .and_then(|bb| u128::try_from(bb).ok())
        .and_then(|bb| a128.checked_mul(o)?.checked_mul(4)?.checked_add(bb))
        .ok_or(MathError::Overflow)?;
    let root = isqrt_ceil(disc) as i128;
    let mut x = to_u64(u128::try_from((root - b + 1) / 2).map_err(|_| MathError::Overflow)?)?;
    // The closed form is exact up to rounding; step to the exact integer answer.
    while x > 0 && out_for_pairs(pool_s, pool_o, x - 1) >= a128 {
        x -= 1;
    }
    while out_for_pairs(pool_s, pool_o, x) < a128 {
        x = x.checked_add(1).ok_or(MathError::Overflow)?;
    }
    // Gross up for the fee: smallest usdc_in with usdc_in - fee(usdc_in) >= x.
    let denom = u128::from(BPS_DENOM - u64::from(fee_bps));
    let mut usdc_in = to_u64((u128::from(x) * u128::from(BPS_DENOM)).div_ceil(denom))?;
    while usdc_in > 0 && usdc_in - 1 - fee_of(usdc_in - 1, fee_bps)? >= x {
        usdc_in -= 1;
    }
    while usdc_in - fee_of(usdc_in, fee_bps)? < x {
        usdc_in = usdc_in.checked_add(1).ok_or(MathError::Overflow)?;
    }
    Ok(usdc_in)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SellResult {
    /// Pairs merged out of the pool.
    pub pairs: u64,
    pub fee: u64,
    /// USDC to the seller (`pairs - fee`).
    pub out: u64,
    pub new_pool_s: u64,
    pub new_pool_o: u64,
}

/// Sell of `a` claims of side S (spec 8.4).
pub fn sell(pool_s: u64, pool_o: u64, a: u64, fee_bps: u16) -> Result<SellResult, MathError> {
    if pool_s == 0 || pool_o == 0 || a == 0 {
        return Err(MathError::InvalidInput);
    }
    let u = u128::from(pool_s) + u128::from(a);
    let d = u128::from(pool_o);
    let k_before = u128::from(pool_s) * d;
    // y = ((U + D) - sqrt((U + D)^2 - 4 a D)) / 2, rounded down (ceil sqrt)
    let sum = u + d;
    let disc = sum
        .checked_mul(sum)
        .and_then(|q| q.checked_sub(u128::from(a).checked_mul(d)?.checked_mul(4)?))
        .ok_or(MathError::Overflow)?;
    let mut y = (sum - isqrt_ceil(disc)) / 2;
    // Keep k: (U - y) * (D - y) >= k_before.
    while y > 0 && (u - y) * (d - y) < k_before {
        y -= 1;
    }
    let pairs = to_u64(y)?;
    if pairs == 0 {
        return Err(MathError::InvalidInput);
    }
    let fee = fee_of(pairs, fee_bps)?;
    Ok(SellResult {
        pairs,
        fee,
        out: pairs - fee,
        new_pool_s: to_u64(u - y)?,
        new_pool_o: to_u64(d - y)?,
    })
}

/// Lock size (spec 10.1): `claims = hours * W / f` with `W = upper - lower`
/// and `f = remaining / duration`. In claim units (1,000,000 = 1 claim),
/// rounded down.
pub fn lock_claims(
    hours: u64,
    lower: u64,
    upper: u64,
    remaining_secs: u64,
    duration_secs: u64,
) -> Result<u64, MathError> {
    if lower >= upper || remaining_secs == 0 || remaining_secs > duration_secs {
        return Err(MathError::InvalidInput);
    }
    let num = u128::from(hours)
        .checked_mul(u128::from(upper - lower))
        .and_then(|v| v.checked_mul(u128::from(duration_secs)))
        .ok_or(MathError::Overflow)?;
    to_u64(num / u128::from(remaining_secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn isqrt_floor_and_ceil() {
        for n in [
            0u128,
            1,
            2,
            3,
            4,
            15,
            16,
            17,
            99,
            100,
            101,
            u64::MAX as u128,
            u128::MAX,
        ] {
            let r = isqrt(n);
            assert!(r * r <= n, "{n}");
            assert!(
                r.checked_add(1)
                    .and_then(|q| q.checked_mul(q))
                    .is_none_or(|q| q > n),
                "{n}"
            );
            let c = isqrt_ceil(n);
            assert!(c == r || (c == r + 1 && r * r != n));
        }
    }

    #[test]
    fn band_value_matches_spec_11() {
        let (lo, hi) = (400_000, 600_000);
        assert_eq!(band_value_ppm(300_000, lo, hi), Ok(0));
        assert_eq!(band_value_ppm(400_000, lo, hi), Ok(0));
        assert_eq!(band_value_ppm(500_000, lo, hi), Ok(500_000));
        assert_eq!(band_value_ppm(600_000, lo, hi), Ok(PPM));
        assert_eq!(band_value_ppm(700_000, lo, hi), Ok(PPM));
        // rounds down: (400_001 - 400_000) * 1e6 / 200_000 = 5
        assert_eq!(band_value_ppm(400_001, lo, hi), Ok(5));
        assert_eq!(band_value_ppm(1, 2, 2), Err(MathError::InvalidInput));
    }

    #[test]
    fn projected_average() {
        // 0.30 for 1 h counted, 2 h left at 0.60: (0.30*1 + 0.60*2) / 3 = 0.50
        assert_eq!(
            projected_avg(300_000 * 3_600, 3_600, 600_000, 7_200),
            Ok(Some(500_000))
        );
        // nothing counted yet: the last price
        assert_eq!(projected_avg(0, 0, 340_000, 86_400), Ok(Some(340_000)));
        // expired: the plain average
        assert_eq!(
            projected_avg(300_000 * 10, 10, 999_999, 0),
            Ok(Some(300_000))
        );
        assert_eq!(projected_avg(0, 0, 340_000, 0), Ok(None));
    }

    #[test]
    fn pause_outside_p_min() {
        assert!(pool_paused(0));
        assert!(pool_paused(19_999));
        assert!(!pool_paused(20_000));
        assert!(!pool_paused(500_000));
        assert!(!pool_paused(980_000));
        assert!(pool_paused(980_001));
        assert_eq!(clamp_price(0), 20_000);
        assert_eq!(clamp_price(PPM), 980_000);
    }

    fn total(h: &Holdings) -> (u64, u64) {
        (h.total_up().unwrap(), h.total_down().unwrap())
    }

    #[test]
    fn seed_at_half_puts_everything_in_the_pool() {
        let seed = Holdings {
            pool_up: 0,
            inv_up: 1_000 * USDC,
            pool_down: 0,
            inv_down: 1_000 * USDC,
        };
        let h = recenter(&seed, 500_000).unwrap();
        assert_eq!(h.pool_up, 1_000 * USDC);
        assert_eq!(h.pool_down, 1_000 * USDC);
        assert_eq!((h.inv_up, h.inv_down), (0, 0));
    }

    #[test]
    fn recenter_sets_the_price_and_keeps_totals() {
        let seed = Holdings {
            pool_up: 0,
            inv_up: 1_000 * USDC,
            pool_down: 0,
            inv_down: 1_000 * USDC,
        };
        for p in [20_000u64, 100_000, 333_333, 500_000, 700_000, 980_000] {
            let h = recenter(&seed, p).unwrap();
            assert_eq!(total(&h), (1_000 * USDC, 1_000 * USDC));
            // price_up = pool_down / (pool_up + pool_down) within 1 ppm
            let price = u128::from(h.pool_down) * 1_000_000
                / (u128::from(h.pool_up) + u128::from(h.pool_down));
            assert!((price as i128 - p as i128).abs() <= 1, "p {p} got {price}");
        }
        // clamped
        let h = recenter(&seed, 0).unwrap();
        let price =
            u128::from(h.pool_down) * 1_000_000 / (u128::from(h.pool_up) + u128::from(h.pool_down));
        assert!((price as i128 - 20_000).abs() <= 1);
    }

    #[test]
    fn fee_rounds_up_and_split_favors_the_vault() {
        assert_eq!(fee_of(40_000_000, 100), Ok(400_000));
        assert_eq!(fee_of(1, 100), Ok(1));
        assert_eq!(fee_of(0, 100), Ok(0));
        assert_eq!(split_fee(400_000, 2_000), Ok((320_000, 80_000)));
        assert_eq!(split_fee(1, 2_000), Ok((1, 0)));
        assert_eq!(split_fee(9, 2_000), Ok((8, 1)));
    }

    #[test]
    fn buy_follows_spec_8_3_and_keeps_k() {
        let (s, o) = (1_000 * USDC, 1_000 * USDC);
        let r = buy(s, o, 41 * USDC, 100).unwrap();
        assert_eq!(r.fee, 410_000);
        assert_eq!(r.pairs, 40_590_000);
        assert_eq!(r.new_pool_o, o + r.pairs);
        assert_eq!(
            r.new_pool_s,
            (u128::from(s) * u128::from(o)).div_ceil(u128::from(r.new_pool_o)) as u64
        );
        assert_eq!(
            u128::from(r.out),
            u128::from(s) + u128::from(r.pairs) - u128::from(r.new_pool_s)
        );
        assert!(
            u128::from(r.new_pool_s) * u128::from(r.new_pool_o) >= u128::from(s) * u128::from(o)
        );
        // at price 0.5, about 2 claims per USDC minus slippage
        assert!(r.out > 79 * USDC && r.out < 2 * r.pairs);
        assert_eq!(
            buy(s, o, 1, 100),
            Err(MathError::InvalidInput),
            "all fee, no pairs"
        );
        assert_eq!(buy(0, o, USDC, 100), Err(MathError::InvalidInput));
    }

    #[test]
    fn exact_out_is_the_smallest_input() {
        let cases = [
            (1_000 * USDC, 1_000 * USDC, 80 * USDC, 100u16),
            (300 * USDC, 1_700 * USDC, 5 * USDC, 100),
            (1_700 * USDC, 300 * USDC, 900 * USDC, 100),
            (1_000, 1_000, 1, 0),
            (50 * USDC, 50 * USDC, 3_000 * USDC, 250),
        ];
        for (s, o, a, fee) in cases {
            let cost = cost_exact_out(s, o, a, fee).unwrap();
            assert!(buy(s, o, cost, fee).unwrap().out >= a, "{s} {o} {a}");
            if let Ok(r) = buy(s, o, cost - 1, fee) {
                assert!(r.out < a, "cost - 1 must not be enough: {s} {o} {a}");
            }
        }
    }

    #[test]
    fn sell_follows_spec_8_4_and_keeps_k() {
        let (s, o) = (1_000 * USDC, 1_000 * USDC);
        let r = sell(s, o, 80 * USDC, 100).unwrap();
        assert_eq!(r.out, r.pairs - r.fee);
        assert_eq!(r.fee, fee_of(r.pairs, 100).unwrap());
        assert!(
            u128::from(r.new_pool_s) * u128::from(r.new_pool_o) >= u128::from(s) * u128::from(o)
        );
        assert_eq!(r.new_pool_s, s + 80 * USDC - r.pairs);
        assert_eq!(r.new_pool_o, o - r.pairs);
        // 80 claims at about 0.5: a bit under 40 USDC of pairs
        assert!(r.pairs > 38 * USDC && r.pairs < 40 * USDC);
        // one more pair would break k
        let y = u128::from(r.pairs) + 1;
        let u = u128::from(s) + 80 * u128::from(USDC);
        assert!((u - y) * (u128::from(o) - y) < u128::from(s) * u128::from(o));
        assert_eq!(sell(s, o, 0, 100), Err(MathError::InvalidInput));
    }

    #[test]
    fn buy_then_sell_never_profits() {
        let (s, o) = (700 * USDC, 1_300 * USDC);
        for usdc in [USDC / 100, USDC, 50 * USDC, 900 * USDC] {
            let b = buy(s, o, usdc, 100).unwrap();
            let back = sell(b.new_pool_s, b.new_pool_o, b.out, 100).unwrap();
            assert!(
                back.out < usdc,
                "round trip of {usdc} returned {}",
                back.out
            );
        }
    }

    /// Spec 10.2: Rina, 400 GPU-hours, band $0.40 to $0.60 at the start of the period.
    #[test]
    fn worked_example_of_spec_10_2() {
        let (lo, hi) = (400_000, 600_000);
        let claims = lock_claims(400, lo, hi, 30 * 86_400, 30 * 86_400).unwrap();
        assert_eq!(claims, 80 * USDC, "80 UP claims");

        // At a pool price of 0.50 she pays about $40 before the fee (deep pool).
        let pool = 100_000 * USDC;
        let cost = cost_exact_out(pool, pool, claims, 0).unwrap();
        assert!(cost > 39_900_000 && cost < 40_100_000, "cost {cost}");
        let with_fee = cost_exact_out(pool, pool, claims, 100).unwrap();
        assert!(with_fee > cost);

        // Outcome table: value of 80 UP for each average price.
        let value = |avg: u64| claims * band_value_ppm(avg, lo, hi).unwrap() / PPM;
        assert_eq!(value(300_000), 0);
        assert_eq!(value(400_000), 0);
        assert_eq!(value(500_000), 40 * USDC);
        assert_eq!(value(600_000), 80 * USDC);
        assert_eq!(value(700_000), 80 * USDC);
        // Net cost for the averages inside the band stays $200 (bill + paid - value).
        for avg in [400_000u64, 500_000, 600_000] {
            let bill = 400 * avg;
            assert_eq!(bill + 40 * USDC - value(avg), 200 * USDC, "avg {avg}");
        }
    }

    #[test]
    fn lock_size_grows_when_less_time_is_left() {
        let full = lock_claims(400, 400_000, 600_000, 1_000, 1_000).unwrap();
        let half = lock_claims(400, 400_000, 600_000, 500, 1_000).unwrap();
        assert_eq!(half, 2 * full);
        assert!(lock_claims(400, 400_000, 600_000, 0, 1_000).is_err());
        assert!(lock_claims(400, 600_000, 400_000, 1, 1).is_err());
    }

    /// Random trades on random pools: k never falls, a buy never pays out more
    /// claims than the pool plus the minted pairs hold, and exact-out gives
    /// the smallest sufficient input.
    #[test]
    fn random_trades_keep_the_invariants() {
        let mut seed: u64 = 0xc1a3_2026;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..3_000 {
            let s = next() % (5_000_000 * USDC) + 1_000;
            let o = next() % (5_000_000 * USDC) + 1_000;
            let k = u128::from(s) * u128::from(o);
            let fee = (next() % 300) as u16;
            let usdc = next() % (100_000 * USDC) + 1;
            if let Ok(b) = buy(s, o, usdc, fee) {
                assert!(u128::from(b.new_pool_s) * u128::from(b.new_pool_o) >= k);
                assert!(b.out <= s + b.pairs);
                assert_eq!(b.fee + b.pairs, usdc);
            }
            let a = next() % (s.max(2) * 2) + 1;
            if let Ok(r) = sell(s, o, a, fee) {
                assert!(u128::from(r.new_pool_s) * u128::from(r.new_pool_o) >= k);
                assert!(r.pairs <= o, "cannot merge more pairs than the pool holds");
                assert_eq!(r.out + r.fee, r.pairs);
            }
            let want = next() % (s / 2 + 1) + 1;
            if let Ok(cost) = cost_exact_out(s, o, want, fee) {
                assert!(buy(s, o, cost, fee).unwrap().out >= want);
                if let Ok(r) = buy(s, o, cost - 1, fee) {
                    assert!(r.out < want);
                }
            }
        }
    }
}
