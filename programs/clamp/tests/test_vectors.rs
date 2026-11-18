//! The index math against the vectors shared with the TypeScript SDK
//! (packages/sdk/test/vectors/index-math.json). If both sides pass, the
//! program and the SDK compute the same numbers.

use clamp::math::{
    median::{
        apply_step_limit, combine_source, median, source_weight, weighted_median, Sample, Weighted,
    },
    twap::{average, find_at_or_before, next_observation, sums_at, Observation},
};
use serde_json::Value;

fn vectors() -> Value {
    let text = include_str!("../../../packages/sdk/test/vectors/index-math.json");
    serde_json::from_str(text).unwrap()
}

fn num(v: &Value) -> u64 {
    v.as_str().unwrap().parse().unwrap()
}
fn opt(v: &Value) -> Option<u64> {
    (!v.is_null()).then(|| num(v))
}
fn list(v: &Value) -> &Vec<Value> {
    v.as_array().unwrap()
}

#[test]
fn median_vectors() {
    for case in list(&vectors()["median"]) {
        let mut values: Vec<u64> = list(&case["values"]).iter().map(num).collect();
        assert_eq!(median(&mut values), opt(&case["expected"]), "{case}");
    }
}

#[test]
fn source_weight_vectors() {
    for case in list(&vectors()["source_weight"]) {
        let got = source_weight(
            case["has_capacity"].as_bool().unwrap(),
            num(&case["capacity"]),
            case["fixed_weight"].as_u64().unwrap() as u8,
        );
        assert_eq!(u64::from(got), case["expected"].as_u64().unwrap(), "{case}");
    }
}

#[test]
fn combine_source_vectors() {
    for case in list(&vectors()["combine_source"]) {
        let samples: Vec<Sample> = list(&case["samples"])
            .iter()
            .map(|s| Sample {
                price: num(&s[0]),
                capacity: num(&s[1]),
            })
            .collect();
        let got = combine_source(
            &samples,
            num(&case["min_price"]),
            num(&case["max_price"]),
            case["min_reporters"].as_u64().unwrap() as u8,
        );
        let expected = (!case["expected"].is_null()).then(|| Sample {
            price: num(&case["expected"][0]),
            capacity: num(&case["expected"][1]),
        });
        assert_eq!(got, expected, "{case}");
    }
}

#[test]
fn weighted_median_vectors() {
    for case in list(&vectors()["weighted_median"]) {
        let mut entries: Vec<Weighted> = list(&case["entries"])
            .iter()
            .map(|e| Weighted {
                price: num(&e[0]),
                weight: e[1].as_u64().unwrap() as u8,
            })
            .collect();
        assert_eq!(
            weighted_median(&mut entries),
            opt(&case["expected"]),
            "{case}"
        );
    }
}

#[test]
fn step_limit_vectors() {
    for case in list(&vectors()["step_limit"]) {
        let got = apply_step_limit(
            num(&case["candidate"]),
            num(&case["last"]),
            num(&case["max_step_ppm"]),
        );
        assert_eq!(got, Ok(num(&case["expected"])), "{case}");
    }
}

#[test]
fn twap_vectors() {
    let v = vectors();
    let t = &v["twap"];
    let max_gap = t["max_gap"].as_i64().unwrap();
    let mut built: Vec<Observation> = Vec::new();
    for u in list(&t["updates"]) {
        let o = next_observation(
            built.last(),
            u["ts"].as_i64().unwrap(),
            num(&u["price"]),
            max_gap,
        )
        .unwrap();
        built.push(o);
    }
    for (o, e) in built.iter().zip(list(&t["observations"])) {
        assert_eq!(o.ts, e["ts"].as_i64().unwrap());
        assert_eq!(o.price, num(&e["price"]));
        assert_eq!(
            o.cum_price,
            e["cum_price"].as_str().unwrap().parse::<u128>().unwrap()
        );
        assert_eq!(o.cum_valid, num(&e["cum_valid"]));
    }
    let n = built.len();
    for a in list(&t["averages"]) {
        let (from, to) = (a["from"].as_i64().unwrap(), a["to"].as_i64().unwrap());
        let ia = find_at_or_before(&built, n - 1, n, from).unwrap();
        let ib = find_at_or_before(&built, n - 1, n, to).unwrap();
        let start = sums_at(&built[ia], from, max_gap).unwrap();
        let end = sums_at(&built[ib], to, max_gap).unwrap();
        assert_eq!(average(&start, &end).unwrap(), opt(&a["expected"]), "{a}");
        assert_eq!(end.cum_valid - start.cum_valid, num(&a["counted"]), "{a}");
    }
}

// ---------------------------------------------------------------- pool and vault

use clamp::math::{
    pool::{
        band_value_ppm, buy, cost_exact_out, lock_claims, projected_avg, recenter, sell, split_fee,
        Holdings,
    },
    vault::{deposit_shares, series_allocation, series_value, withdraw_amount, Rounding},
};
use serde_json::json;

/// Deterministic cases computed by the Rust math. Errors are written as null.
fn pool_vault_cases() -> Value {
    let mut seed: u64 = 0x0b0b_2026;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    const U: u64 = 1_000_000;
    let s = |x: u64| x.to_string();
    let (mut buys, mut sells, mut exacts, mut recenters, mut bands, mut projs) =
        (vec![], vec![], vec![], vec![], vec![], vec![]);
    let (mut values, mut deposits, mut withdraws, mut allocs, mut fees, mut locks) =
        (vec![], vec![], vec![], vec![], vec![], vec![]);
    for _ in 0..200 {
        let ps = next() % (2_000_000 * U) + 1_000;
        let po = next() % (2_000_000 * U) + 1_000;
        let fee = (next() % 300) as u16;
        let usdc = next() % (50_000 * U) + 1;
        buys.push(json!({"s": s(ps), "o": s(po), "usdc": s(usdc), "fee_bps": fee,
            "result": buy(ps, po, usdc, fee).ok().map(|r| json!({"fee": s(r.fee), "pairs": s(r.pairs),
                "out": s(r.out), "new_s": s(r.new_pool_s), "new_o": s(r.new_pool_o)}))}));
        let a = next() % (ps * 2) + 1;
        sells.push(json!({"s": s(ps), "o": s(po), "a": s(a), "fee_bps": fee,
            "result": sell(ps, po, a, fee).ok().map(|r| json!({"pairs": s(r.pairs), "fee": s(r.fee),
                "out": s(r.out), "new_s": s(r.new_pool_s), "new_o": s(r.new_pool_o)}))}));
        let want = next() % (ps / 2 + 1) + 1;
        exacts.push(json!({"s": s(ps), "o": s(po), "a": s(want), "fee_bps": fee,
            "result": cost_exact_out(ps, po, want, fee).ok().map(s)}));
        let h = Holdings {
            pool_up: next() % (1_000 * U),
            inv_up: next() % (1_000 * U),
            pool_down: next() % (1_000 * U),
            inv_down: next() % (1_000 * U),
        };
        let p = next() % 1_000_001;
        recenters.push(json!({"h": [s(h.pool_up), s(h.inv_up), s(h.pool_down), s(h.inv_down)], "p": s(p),
            "result": recenter(&h, p).ok().map(|r| json!([s(r.pool_up), s(r.inv_up), s(r.pool_down), s(r.inv_down)]))}));
        let lo = next() % 5_000_000 + 1;
        let hi = lo + next() % 2_000_000 + 1;
        let avg = next() % 8_000_000;
        bands.push(json!({"avg": s(avg), "lower": s(lo), "upper": s(hi), "result": band_value_ppm(avg, lo, hi).ok().map(s)}));
        let secs = next() % 2_592_000;
        let cp = u128::from(next() % 5_000_000) * u128::from(secs);
        let rem = next() % 2_592_000;
        let last = next() % 5_000_000;
        projs.push(json!({"counted_price": cp.to_string(), "counted_secs": s(secs), "last": s(last), "remaining": s(rem),
            "result": projected_avg(cp, secs, last, rem).ok().flatten().map(s)}));
        let (tu, td, v) = (
            next() % (1_000 * U),
            next() % (1_000 * U),
            next() % 1_000_001,
        );
        values.push(json!({"up": s(tu), "down": s(td), "v": s(v),
            "down_rounded": series_value(tu, td, v, Rounding::Down).ok().map(s),
            "up_rounded": series_value(tu, td, v, Rounding::Up).ok().map(s)}));
        let total = if next() % 5 == 0 {
            0
        } else {
            next() % (1_000_000 * U) + 1
        };
        let navv = next() % (1_000_000 * U);
        let amount = next() % (100_000 * U) + 1;
        deposits.push(
            json!({"amount": s(amount), "total": s(total), "nav_up": s(navv),
            "result": deposit_shares(amount, total, navv).ok().map(|(a, b)| json!([s(a), s(b)]))}),
        );
        let total_w = next() % (1_000_000 * U) + 1;
        let shares = next() % (total_w + 2);
        withdraws.push(
            json!({"shares": s(shares), "total": s(total_w), "nav_down": s(navv),
            "result": withdraw_amount(shares, total_w, navv).ok().map(s)}),
        );
        let idle = next() % (1_000_000 * U);
        let bps = (next() % 10_001) as u16;
        allocs.push(json!({"nav": s(navv), "idle": s(idle), "bps": bps, "result": series_allocation(navv, idle, bps).ok().map(s)}));
        let f = next() % (10 * U);
        let share = (next() % 10_001) as u16;
        fees.push(json!({"fee": s(f), "protocol_bps": share, "result": split_fee(f, share).ok().map(|(a, b)| json!([s(a), s(b)]))}));
        let dur = 604_800;
        let rem2 = next() % dur + 1;
        let hours = next() % 2_000;
        locks.push(json!({"hours": s(hours), "lower": s(lo), "upper": s(hi), "remaining": s(rem2), "duration": s(dur),
            "result": lock_claims(hours, lo, hi, rem2, dur).ok().map(s)}));
    }
    json!({
        "note": "Written by programs/clamp/tests/test_vectors.rs (cargo test -p clamp --test test_vectors -- --ignored write_pool_vault_vectors). Read by the Rust and SDK tests. null = the function returns an error.",
        "buy": buys, "sell": sells, "cost_exact_out": exacts, "recenter": recenters,
        "band_value": bands, "projected_avg": projs, "series_value": values,
        "deposit_shares": deposits, "withdraw_amount": withdraws, "series_allocation": allocs,
        "split_fee": fees, "lock_claims": locks,
    })
}

#[test]
#[ignore = "writes the vector file; run on purpose after a math change"]
fn write_pool_vault_vectors() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/",
        "../../packages/sdk/test/vectors/pool-vault.json"
    );
    std::fs::write(
        path,
        serde_json::to_string_pretty(&pool_vault_cases()).unwrap() + "\n",
    )
    .unwrap();
}

#[test]
fn pool_vault_vectors_match_the_rust_math() {
    let saved: Value = serde_json::from_str(include_str!(
        "../../../packages/sdk/test/vectors/pool-vault.json"
    ))
    .unwrap();
    assert_eq!(
        saved,
        pool_vault_cases(),
        "vector file is stale: rerun write_pool_vault_vectors"
    );
}
