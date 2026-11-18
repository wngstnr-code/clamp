//! Vault math (spec 9). Pure functions.
//!
//! The vault is valued with the index, not with the pool price. NAV is
//! computed twice with opposite rounding so that every rounding favors the
//! vault's existing holders: deposits use the NAV rounded up (fewer shares),
//! withdrawals the NAV rounded down (fewer USDC).

use super::pool::BPS_DENOM;
use super::{MathError, PPM};

/// First deposit must be at least 10 USDC (spec 9.2).
pub const MIN_FIRST_DEPOSIT: u64 = 10_000_000;
/// Share units locked forever by the first deposit (spec 9.2).
pub const LOCKED_SHARES: u64 = 1_000;

fn to_u64(x: u128) -> Result<u64, MathError> {
    u64::try_from(x).map_err(|_| MathError::Overflow)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rounding {
    Down,
    Up,
}

/// Value of the vault's units in one series (spec 9.1):
/// `T_up * v + T_down * (1 - v)`, with `v` the fair value (live series) or
/// the settled UP value, in ppm.
pub fn series_value(
    t_up: u64,
    t_down: u64,
    v_ppm: u64,
    rounding: Rounding,
) -> Result<u64, MathError> {
    if v_ppm > PPM {
        return Err(MathError::InvalidInput);
    }
    let num = u128::from(t_up) * u128::from(v_ppm) + u128::from(t_down) * u128::from(PPM - v_ppm);
    let ppm = u128::from(PPM);
    to_u64(match rounding {
        Rounding::Down => num / ppm,
        Rounding::Up => num.div_ceil(ppm),
    })
}

/// NAV = idle USDC + the value of every active series.
pub fn nav(idle: u64, series_values: &[u64]) -> Result<u64, MathError> {
    series_values
        .iter()
        .try_fold(idle, |acc, v| acc.checked_add(*v))
        .ok_or(MathError::Overflow)
}

/// Shares for a deposit. Returns `(shares_to_depositor, shares_locked)`.
///
/// First deposit (`total_shares == 0`): 1 to 1, at least 10 USDC, and 1,000
/// share units are locked forever. Later deposits: `amount * total / nav_up`,
/// rounded down. Fails when the vault has shares but no value.
pub fn deposit_shares(
    amount: u64,
    total_shares: u64,
    nav_up: u64,
) -> Result<(u64, u64), MathError> {
    if amount == 0 {
        return Err(MathError::InvalidInput);
    }
    if total_shares == 0 {
        if amount < MIN_FIRST_DEPOSIT {
            return Err(MathError::InvalidInput);
        }
        return Ok((amount - LOCKED_SHARES, LOCKED_SHARES));
    }
    if nav_up == 0 {
        return Err(MathError::InvalidInput);
    }
    let shares = to_u64(u128::from(amount) * u128::from(total_shares) / u128::from(nav_up))?;
    if shares == 0 {
        return Err(MathError::InvalidInput);
    }
    Ok((shares, 0))
}

/// USDC paid for burning `shares`: `shares * nav_down / total`, rounded down.
pub fn withdraw_amount(shares: u64, total_shares: u64, nav_down: u64) -> Result<u64, MathError> {
    if shares == 0 || shares > total_shares {
        return Err(MathError::InvalidInput);
    }
    to_u64(u128::from(shares) * u128::from(nav_down) / u128::from(total_shares))
}

/// Allocation of one series (spec 9.2): `min(NAV * alloc_bps / 10000, idle)`.
pub fn series_allocation(nav_down: u64, idle: u64, alloc_bps: u16) -> Result<u64, MathError> {
    if u64::from(alloc_bps) > BPS_DENOM {
        return Err(MathError::InvalidInput);
    }
    let share = to_u64(u128::from(nav_down) * u128::from(alloc_bps) / u128::from(BPS_DENOM))?;
    Ok(share.min(idle))
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn series_value_uses_the_index_value() {
        // 100 UP and 100 DOWN are always worth 100 USDC
        for v in [0, 1, 333_333, 500_000, PPM] {
            assert_eq!(
                series_value(100 * USDC, 100 * USDC, v, Rounding::Down),
                Ok(100 * USDC)
            );
        }
        // 120 UP and 80 DOWN at v = 0.25: 30 + 60 = 90
        assert_eq!(
            series_value(120 * USDC, 80 * USDC, 250_000, Rounding::Down),
            Ok(90 * USDC)
        );
        // rounding: 1 UP unit at v = 0.5 is half a unit
        assert_eq!(series_value(1, 0, 500_000, Rounding::Down), Ok(0));
        assert_eq!(series_value(1, 0, 500_000, Rounding::Up), Ok(1));
        assert_eq!(
            series_value(1, 1, PPM + 1, Rounding::Down),
            Err(MathError::InvalidInput)
        );
    }

    #[test]
    fn nav_adds_idle_and_series() {
        assert_eq!(nav(5, &[1, 2, 3]), Ok(11));
        assert_eq!(nav(u64::MAX, &[1]), Err(MathError::Overflow));
    }

    #[test]
    fn first_deposit_is_one_to_one_with_locked_shares() {
        assert_eq!(
            deposit_shares(10 * USDC, 0, 0),
            Ok((10 * USDC - 1_000, 1_000))
        );
        assert_eq!(
            deposit_shares(10 * USDC - 1, 0, 0),
            Err(MathError::InvalidInput)
        );
    }

    #[test]
    fn later_deposits_and_withdrawals_round_for_the_vault() {
        // NAV grew from 100 to 110 USDC with 100 shares outstanding
        let total = 100 * USDC;
        let (shares, locked) = deposit_shares(11 * USDC, total, 110 * USDC).unwrap();
        assert_eq!((shares, locked), (10 * USDC, 0));
        assert_eq!(withdraw_amount(10 * USDC, total, 110 * USDC), Ok(11 * USDC));
        // 1 unit deposit that would give 0 shares is refused
        assert_eq!(deposit_shares(1, 100, 1_000), Err(MathError::InvalidInput));
        assert_eq!(withdraw_amount(0, total, 1), Err(MathError::InvalidInput));
        assert_eq!(
            withdraw_amount(total + 1, total, 1),
            Err(MathError::InvalidInput)
        );
        assert_eq!(deposit_shares(USDC, total, 0), Err(MathError::InvalidInput));
    }

    /// Deposit then withdraw at once never returns more than was paid in.
    #[test]
    fn no_profit_from_a_deposit_withdraw_round_trip() {
        let mut seed: u64 = 0x9e37_79b9;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..10_000 {
            let total = next() % (1_000_000 * USDC) + 1_000;
            let nav_down = next() % (1_000_000 * USDC) + 1;
            let nav_up = nav_down + next() % 3;
            let amount = next() % (100_000 * USDC) + 1;
            let Ok((shares, _)) = deposit_shares(amount, total, nav_up) else {
                continue;
            };
            let back = withdraw_amount(shares, total + shares, nav_down + amount).unwrap();
            assert!(back <= amount, "paid {amount}, got {back}");
        }
    }

    #[test]
    fn allocation_is_capped_by_idle() {
        assert_eq!(
            series_allocation(1_000 * USDC, 1_000 * USDC, 1_000),
            Ok(100 * USDC)
        );
        assert_eq!(
            series_allocation(1_000 * USDC, 30 * USDC, 1_000),
            Ok(30 * USDC)
        );
        assert_eq!(series_allocation(1_000 * USDC, 0, 1_000), Ok(0));
        assert_eq!(
            series_allocation(1, 1, 10_001),
            Err(MathError::InvalidInput)
        );
    }
}
