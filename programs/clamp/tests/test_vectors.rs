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
