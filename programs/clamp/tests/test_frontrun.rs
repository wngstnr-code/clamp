//! Front-running simulation (known issue "traders who see an API price before
//! the on-chain update"). Uses the pool math of the program. Run with
//! `cargo test --test test_frontrun -- --nocapture` to print the tables.
//!
//! Scenario: a daily series with the devnet numbers (center $0.3636, half
//! width 10%, allocation 200 USDC, fee 1%). The index was flat so far. The
//! attacker learns that the next update moves the index by `dp`, buys the
//! winning side before the update, and sells right after it (the first trade
//! after the update re-centers the pool to the new fair value).

use clamp::math::pool::{band_value_ppm, buy, projected_avg, recenter, sell, split_fee, Holdings};
use clamp::math::vault::{series_value, Rounding};
use clamp::math::PPM;

const CENTER: u64 = 363_600;
const LOWER: u64 = 327_240;
const UPPER: u64 = 399_960;
const DURATION: u64 = 86_400;
const ALLOC: u64 = 200_000_000;
const FEE_BPS: u16 = 100;
const PROTOCOL_BPS: u16 = 2_000;

/// Fair value after `elapsed` seconds at `CENTER`, then `price` for the rest.
fn fair_value(elapsed: u64, price: u64) -> u64 {
    let avg = projected_avg(
        u128::from(CENTER) * u128::from(elapsed),
        elapsed,
        price,
        DURATION - elapsed,
    )
    .unwrap()
    .unwrap();
    band_value_ppm(avg, LOWER, UPPER).unwrap()
}

struct Outcome {
    usdc_in: u64,
    profit: i128,
    vault_change: i128,
    protocol_fee: u64,
}

/// Buys UP with `usdc_in` at fair value `v0`, re-centers to `v1`, sells all.
fn sandwich(v0: u64, v1: u64, usdc_in: u64) -> Option<Outcome> {
    let seeded = recenter(
        &Holdings {
            inv_up: ALLOC,
            inv_down: ALLOC,
            ..Default::default()
        },
        v0,
    )
    .ok()?;
    let b = buy(seeded.pool_up, seeded.pool_down, usdc_in, FEE_BPS).ok()?;
    let after_buy = Holdings {
        pool_up: b.new_pool_s,
        pool_down: b.new_pool_o,
        ..seeded
    };
    let h = recenter(&after_buy, v1).ok()?;
    let s = sell(h.pool_up, h.pool_down, b.out, FEE_BPS).ok()?;
    let end = Holdings {
        pool_up: s.new_pool_s,
        pool_down: s.new_pool_o,
        ..h
    };
    let (vault_fee_b, protocol_b) = split_fee(b.fee, PROTOCOL_BPS).ok()?;
    let (vault_fee_s, protocol_s) = split_fee(s.fee, PROTOCOL_BPS).ok()?;
    // The vault's value at the new fair value, with and without the attack.
    let with_attack = series_value(
        end.total_up().ok()?,
        end.total_down().ok()?,
        v1,
        Rounding::Down,
    )
    .ok()?
        + vault_fee_b
        + vault_fee_s;
    let without = series_value(ALLOC, ALLOC, v1, Rounding::Down).ok()?;
    Some(Outcome {
        usdc_in,
        profit: i128::from(s.out) - i128::from(usdc_in),
        vault_change: i128::from(with_attack) - i128::from(without),
        protocol_fee: protocol_b + protocol_s,
    })
}

/// The best attack over a grid of sizes (1 to 400 USDC).
fn best(v0: u64, v1: u64) -> Outcome {
    (1..=400u64)
        .filter_map(|usdc| sandwich(v0, v1, usdc * 1_000_000))
        .max_by_key(|o| o.profit)
        .unwrap()
}

fn usd(x: i128) -> String {
    format!("{:.2}", x as f64 / 1e6)
}

#[test]
fn front_running_the_pool() {
    println!("\nelapsed  move   v0 -> v1        best buy  attacker  vault    bound (alloc * dv)");
    for elapsed in [3_600u64, 43_200, 79_200] {
        for dp_bps in [50u64, 100, 200, 500, 1_000] {
            let v0 = fair_value(elapsed, CENTER);
            let v1 = fair_value(elapsed, CENTER * (10_000 + dp_bps) / 10_000);
            let o = best(v0, v1);
            let bound = i128::from(ALLOC) * i128::from(v1 - v0) / i128::from(PPM);
            println!(
                "{:>5} h  {:>4}%  {:.3} -> {:.3}  {:>8}  {:>8}  {:>7}  {:>7}",
                elapsed / 3_600,
                dp_bps as f64 / 100.0,
                v0 as f64 / 1e6,
                v1 as f64 / 1e6,
                usd(i128::from(o.usdc_in)),
                usd(o.profit),
                usd(o.vault_change),
                usd(bound),
            );
            // Zero sum: what the attacker wins, the vault and the treasury lose
            // (within rounding of a few micro-USDC).
            let sum = o.profit + o.vault_change + i128::from(o.protocol_fee);
            assert!(sum.abs() <= 10, "not zero sum: {sum}");
            // The vault never loses more than its allocation times the move of v.
            assert!(-o.vault_change <= bound + 10);
            // A move of v below the round trip fee is never profitable.
            if v1 - v0 < 20_000 {
                assert!(o.profit <= 0, "profit {} at dv {}", o.profit, v1 - v0);
            }
        }
    }
}

/// Deposit before an update that raises the NAV, withdraw after it. The NAV
/// moves only through the vault's net position: after users bought `q` UP
/// claims from the pool, the vault holds `q` more DOWN than UP.
#[test]
fn front_running_the_vault() {
    let nav: u128 = 2_000_000_000;
    println!("\nnet user UP  move of v  NAV change  attacker gain (deposit = NAV)");
    for q_usdc in [10u128, 50, 100] {
        for dv in [10_000u128, 50_000, 100_000] {
            let q = q_usdc * 1_000_000;
            // The index falls: v drops by dv, the vault's extra DOWN gains.
            let nav_change = q * dv / u128::from(PPM);
            let deposit = nav;
            let gain = deposit * nav_change / (nav + deposit);
            println!(
                "{:>8} UP  {:>8.3}  {:>10}  {:>10}",
                q_usdc,
                dv as f64 / 1e6,
                usd(nav_change as i128),
                usd(gain as i128)
            );
            assert!(gain <= nav_change);
        }
    }
}
