//! Series, claim pairs, settlement and redeem (spec 7, 11) in LiteSVM with the
//! real SPL Token and ATA programs and an index built from real reports.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::associated_token::get_associated_token_address,
    clamp::{
        instructions::{ClassParams, InitializeParams},
        state::{ClassConfig, Observations, Series, Source},
        MAX_SOURCES,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const CLASS: u8 = 1;
const DAILY: u8 = 0;
const T0: i64 = 1_800_000_000;
const USDC: u64 = 1_000_000;
const C: [u32; MAX_SOURCES] = [40, 0, 3, 0, 0, 0];

/// All four sources at one price; the weighted median is that price.
fn prices(p: u64) -> [u64; MAX_SOURCES] {
    [p, p, p, p, 0, 0]
}

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    reporter: Keypair,
    user: Keypair,
    mint: Pubkey,
    obs: Pubkey,
    now: i64,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &clamp::id()).0
}
fn config_pda() -> Pubkey {
    pda(&[b"config"])
}
fn class_pda() -> Pubkey {
    pda(&[b"class", &[CLASS]])
}
fn index_pda() -> Pubkey {
    pda(&[b"index", &[CLASS]])
}
fn series_pda(kind: u8, seq: u32) -> Pubkey {
    pda(&[b"series", &[CLASS], &[kind], &seq.to_le_bytes()])
}
fn child(seed: &[u8], series: &Pubkey) -> Pubkey {
    pda(&[seed, series.as_ref()])
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair) -> Result<u64, String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
        .map(|m| m.compute_units_consumed)
        .map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs))
}

#[track_caller]
fn assert_err(result: Result<u64, String>, name: &str) {
    match result {
        Ok(_) => panic!("expected {name}, got success"),
        Err(e) => assert!(e.contains(name), "expected {name}, got: {e}"),
    }
}

fn put(svm: &mut LiteSVM, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
    svm.set_account(
        key,
        solana_account::Account {
            lamports: 10_000_000_000,
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn mint_data(authority: &Pubkey) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = 6;
    d[45] = 1;
    d
}

fn token_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    d
}

fn balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let acc = svm.get_account(account).expect("token account exists");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(key).unwrap().data.as_slice()).unwrap()
}

impl Env {
    fn set_time(&mut self, ts: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = ts;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
        self.now = ts;
    }

    fn report(&mut self, p: u64) -> Result<u64, String> {
        let mut hashes = [[0u8; 32]; MAX_SOURCES];
        for (h, x) in hashes.iter_mut().zip(prices(p)) {
            if x > 0 {
                *h = [7u8; 32];
            }
        }
        let ix = Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::SubmitReport {
                class_id: CLASS,
                prices: prices(p),
                capacities: C,
                raw_hashes: hashes,
            }
            .data(),
            clamp::accounts::SubmitReport {
                reporter: self.reporter.pubkey(),
                class_config: class_pda(),
                index_state: index_pda(),
                observations: self.obs,
            }
            .to_account_metas(None),
        );
        let reporter = self.reporter.insecure_clone();
        send(&mut self.svm, ix, &reporter)
    }

    /// Reports `p` every 600 s for `secs` seconds, starting now.
    fn run_index(&mut self, p: u64, secs: i64) {
        let end = self.now + secs;
        while self.now <= end {
            self.report(p).unwrap();
            let next = self.now + 600;
            self.set_time(next);
        }
        let back = self.now - 600;
        self.set_time(back);
    }

    fn create_series_ix(&self, kind: u8, seq: u32) -> Instruction {
        let series = series_pda(kind, seq);
        Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::CreateSeries {
                class_id: CLASS,
                kind,
            }
            .data(),
            clamp::accounts::CreateSeries {
                creator: self.user.pubkey(),
                config: config_pda(),
                class_config: class_pda(),
                index_state: index_pda(),
                observations: self.obs,
                series,
                collateral_mint: self.mint,
                up_mint: child(b"up", &series),
                down_mint: child(b"down", &series),
                collateral: child(b"collateral", &series),
                up_vault: child(b"upv", &series),
                down_vault: child(b"downv", &series),
                token_program: anchor_spl::token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn create_series(&mut self, kind: u8, seq: u32) -> Result<u64, String> {
        let ix = self.create_series_ix(kind, seq);
        let user = self.user.insecure_clone();
        send(&mut self.svm, ix, &user)
    }

    fn user_collateral(&self) -> Pubkey {
        get_associated_token_address(&self.user.pubkey(), &self.mint)
    }

    fn pairs_ix(&self, series: Pubkey, amount: u64, mint: bool) -> Instruction {
        let up = child(b"up", &series);
        let down = child(b"down", &series);
        let accounts = clamp::accounts::Pairs {
            user: self.user.pubkey(),
            series,
            up_mint: up,
            down_mint: down,
            collateral: child(b"collateral", &series),
            collateral_mint: self.mint,
            user_collateral: self.user_collateral(),
            user_up: get_associated_token_address(&self.user.pubkey(), &up),
            user_down: get_associated_token_address(&self.user.pubkey(), &down),
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        let data = if mint {
            clamp::instruction::MintPairs { amount }.data()
        } else {
            clamp::instruction::MergePairs { amount }.data()
        };
        Instruction::new_with_bytes(clamp::id(), &data, accounts)
    }

    fn pairs(&mut self, series: Pubkey, amount: u64, mint: bool) -> Result<u64, String> {
        let ix = self.pairs_ix(series, amount, mint);
        let user = self.user.insecure_clone();
        send(&mut self.svm, ix, &user)
    }

    fn settle(&mut self, series: Pubkey) -> Result<u64, String> {
        let ix = Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::SettleSeries {}.data(),
            clamp::accounts::SettleSeries {
                series,
                index_state: index_pda(),
                observations: self.obs,
            }
            .to_account_metas(None),
        );
        let user = self.user.insecure_clone();
        send(&mut self.svm, ix, &user)
    }

    fn redeem(
        &mut self,
        series: Pubkey,
        side: u8,
        mint: Pubkey,
        amount: u64,
    ) -> Result<u64, String> {
        let ix = Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::Redeem { side, amount }.data(),
            clamp::accounts::Redeem {
                user: self.user.pubkey(),
                series,
                claim_mint: mint,
                user_claims: get_associated_token_address(&self.user.pubkey(), &mint),
                collateral: child(b"collateral", &series),
                collateral_mint: self.mint,
                user_collateral: self.user_collateral(),
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        );
        let user = self.user.insecure_clone();
        send(&mut self.svm, ix, &user)
    }
}

/// Config, class 1 (one reporter, quorum 1, half widths 10/15/20%), index,
/// and a user with 1,000 tUSDC. The index has no history yet.
fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/clamp.so"));
    svm.add_program(clamp::id(), bytes).unwrap();
    let admin = Keypair::new();
    let reporter = Keypair::new();
    let user = Keypair::new();
    for k in [&admin, &reporter, &user] {
        svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
    }
    let pd = Pubkey::find_program_address(&[clamp::id().as_ref()], &bpf_loader_upgradeable::id()).0;
    let mut acc = svm.get_account(&pd).unwrap();
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(pd, acc).unwrap();

    let mint = Pubkey::new_unique();
    put(
        &mut svm,
        mint,
        anchor_spl::token::ID,
        mint_data(&admin.pubkey()),
    );
    let treasury = Pubkey::new_unique();
    put(
        &mut svm,
        treasury,
        anchor_spl::token::ID,
        token_data(&mint, &admin.pubkey(), 0),
    );
    let user_collateral = get_associated_token_address(&user.pubkey(), &mint);
    put(
        &mut svm,
        user_collateral,
        anchor_spl::token::ID,
        token_data(&mint, &user.pubkey(), 1_000 * USDC),
    );
    let obs = Pubkey::new_unique();
    put(&mut svm, obs, clamp::id(), vec![0u8; Observations::SIZE]);

    let mut env = Env {
        svm,
        admin,
        reporter,
        user,
        mint,
        obs,
        now: 0,
    };
    env.set_time(T0);
    let admin = env.admin.insecure_clone();

    let ix = Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::Initialize {
            params: InitializeParams {
                trade_fee_bps: 100,
                protocol_share_bps: 2_000,
                series_alloc_bps: 1_000,
            },
        }
        .data(),
        clamp::accounts::Initialize {
            admin: admin.pubkey(),
            config: config_pda(),
            collateral_mint: mint,
            treasury,
            program: clamp::id(),
            program_data: pd,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, ix, &admin).unwrap();

    let sources = vec![
        Source {
            source_id: 1,
            has_capacity: true,
            fixed_weight: 0,
        },
        Source {
            source_id: 2,
            has_capacity: false,
            fixed_weight: 2,
        },
        Source {
            source_id: 3,
            has_capacity: true,
            fixed_weight: 0,
        },
        Source {
            source_id: 4,
            has_capacity: false,
            fixed_weight: 1,
        },
    ];
    let params = ClassParams {
        name: [0u8; 16],
        enabled: true,
        reporters: vec![env.reporter.pubkey()],
        min_reporters: 1,
        sources,
        min_sources: 2,
        min_total_weight: 3,
        min_price: 50_000,
        max_price: 5_000_000,
        max_step_ppm: 100_000,
        half_width_ppm: [100_000, 150_000, 200_000],
    };
    let ix = Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::SetClass {
            class_id: CLASS,
            params,
        }
        .data(),
        clamp::accounts::SetClass {
            admin: admin.pubkey(),
            config: config_pda(),
            class_config: class_pda(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, ix, &admin).unwrap();
    let ix = Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::InitIndex { class_id: CLASS }.data(),
        clamp::accounts::InitIndex {
            admin: admin.pubkey(),
            config: config_pda(),
            class_config: class_pda(),
            index_state: index_pda(),
            observations: obs,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, ix, &admin).unwrap();
    env
}

/// Setup plus seven hours of index history at $0.31.
fn with_history() -> Env {
    let mut env = setup();
    env.run_index(310_000, 7 * 3_600);
    env
}

#[test]
fn create_series_sets_band_times_and_snapshot() {
    let mut env = with_history();
    let cu = env.create_series(DAILY, 0).unwrap();
    println!("create_series: {cu} CU");
    let key = series_pda(DAILY, 0);
    let s: Series = read(&env.svm, &key);
    assert_eq!(s.center, 310_000);
    assert_eq!((s.lower, s.upper), (279_000, 341_000), "10% half width");
    assert_eq!(s.start_ts, env.now);
    assert_eq!(s.expiry_ts, env.now + 86_400);
    assert_eq!(s.close_ts, env.now + 86_400 - 3_600);
    assert_eq!(s.start_index, 310_000);
    assert_eq!((s.trade_fee_bps, s.protocol_share_bps), (100, 2_000));
    assert_eq!(s.up_mint, child(b"up", &key));
    assert!(!s.settled && !s.seeded);
    let class: ClassConfig = read(&env.svm, &class_pda());
    assert_eq!(class.current_series[0], key);
    assert_eq!(class.current_expiry[0], s.expiry_ts);
    assert_eq!(class.series_count, [1, 0, 0]);
    // the weekly kind uses its own sequence and band
    env.create_series(1, 0).unwrap();
    let w: Series = read(&env.svm, &series_pda(1, 0));
    assert_eq!((w.lower, w.upper), (263_500, 356_500), "15% half width");
}

#[test]
fn create_series_refuses_live_series_bad_kind_thin_or_stale_history() {
    let mut env = setup();
    env.run_index(310_000, 3 * 3_600);
    assert_err(env.create_series(DAILY, 0), "NotEnoughHistory");
    env.run_index(310_000, 4 * 3_600);
    env.create_series(DAILY, 0).unwrap();
    assert_err(env.create_series(DAILY, 1), "SeriesStillLive");
    assert_err(env.create_series(3, 0), "InvalidKind");
    // no update for more than MAX_GAP
    let later = env.now + 7_201;
    env.set_time(later);
    assert_err(env.create_series(1, 0), "IndexStale");
}

#[test]
fn mint_and_merge_keep_pairs_fully_collateralized() {
    let mut env = with_history();
    env.create_series(DAILY, 0).unwrap();
    let key = series_pda(DAILY, 0);
    let up = get_associated_token_address(&env.user.pubkey(), &child(b"up", &key));
    let down = get_associated_token_address(&env.user.pubkey(), &child(b"down", &key));
    let collateral = child(b"collateral", &key);

    env.pairs(key, 100 * USDC, true).unwrap();
    assert_eq!(balance(&env.svm, &up), 100 * USDC);
    assert_eq!(balance(&env.svm, &down), 100 * USDC);
    assert_eq!(balance(&env.svm, &collateral), 100 * USDC);
    assert_eq!(balance(&env.svm, &env.user_collateral()), 900 * USDC);

    env.pairs(key, 40 * USDC, false).unwrap();
    assert_eq!(balance(&env.svm, &up), 60 * USDC);
    assert_eq!(balance(&env.svm, &collateral), 60 * USDC);
    assert_eq!(balance(&env.svm, &env.user_collateral()), 940 * USDC);
    let s: Series = read(&env.svm, &key);
    assert_eq!(s.pairs_outstanding, 60 * USDC);

    assert_err(env.pairs(key, 0, true), "ZeroAmount");
    // cannot merge more than held, cannot mint more than owned
    assert!(env.pairs(key, 61 * USDC, false).is_err());
    assert!(env.pairs(key, 941 * USDC, true).is_err());
}

#[test]
fn pairs_refuse_accounts_of_another_series() {
    let mut env = with_history();
    env.create_series(DAILY, 0).unwrap();
    env.create_series(1, 0).unwrap();
    let daily = series_pda(DAILY, 0);
    let weekly = series_pda(1, 0);
    let mut ix = env.pairs_ix(daily, USDC, true);
    // swap in the weekly series' collateral account
    ix.accounts[4].pubkey = child(b"collateral", &weekly);
    let user = env.user.insecure_clone();
    assert_err(send(&mut env.svm, ix, &user), "WrongTokenAccount");
}

/// A full day: $0.31 until the first update after creation, then $0.33.
#[test]
fn settle_and_redeem_a_daily_series() {
    let mut env = with_history();
    env.create_series(DAILY, 0).unwrap();
    let key = series_pda(DAILY, 0);
    let s: Series = read(&env.svm, &key);
    env.pairs(key, 100 * USDC, true).unwrap();

    assert_err(env.settle(key), "NotExpired");
    assert_err(env.redeem(key, 0, s.up_mint, USDC), "NotSettled");

    let start = env.now;
    let first = start + 600;
    env.set_time(first);
    env.run_index(330_000, 86_400 - 600);
    assert_eq!(env.now, s.expiry_ts);
    env.settle(key).unwrap();

    let settled: Series = read(&env.svm, &key);
    // $0.31 for the 600 s before the first new update, then $0.33
    let expected_avg = (310_000u128 * 600 + 330_000u128 * (86_400 - 600)) / 86_400;
    assert_eq!(u128::from(settled.avg), expected_avg);
    let expected_up = (expected_avg - 279_000) * 1_000_000 / (341_000 - 279_000);
    assert_eq!(u128::from(settled.up_value), expected_up);
    assert_eq!(settled.coverage_ppm, 1_000_000);
    assert_err(env.settle(key), "SeriesSettled");
    assert_err(env.pairs(key, USDC, true), "SeriesSettled");

    // redeem both sides: together they pay the 100 USDC back (up to rounding dust)
    let before = balance(&env.svm, &env.user_collateral());
    env.redeem(key, 0, settled.up_mint, 100 * USDC).unwrap();
    env.redeem(key, 1, settled.down_mint, 100 * USDC).unwrap();
    let paid = balance(&env.svm, &env.user_collateral()) - before;
    assert!((100 * USDC - 1..=100 * USDC).contains(&paid), "paid {paid}");
    assert_eq!(
        balance(&env.svm, &child(b"collateral", &key)),
        100 * USDC - paid
    );

    // wrong mint for the side, wrong side, nothing left to burn
    assert_err(env.redeem(key, 0, settled.down_mint, 1), "WrongMint");
    assert_err(env.redeem(key, 2, settled.up_mint, 1), "InvalidSide");
    assert!(env.redeem(key, 0, settled.up_mint, 1).is_err());
}

#[test]
fn the_next_series_starts_after_expiry() {
    let mut env = with_history();
    env.create_series(DAILY, 0).unwrap();
    let first = env.now + 600;
    env.set_time(first);
    env.run_index(310_000, 86_400);
    env.create_series(DAILY, 1).unwrap();
    let class: ClassConfig = read(&env.svm, &class_pda());
    assert_eq!(class.series_count[0], 2);
    assert_eq!(class.current_series[0], series_pda(DAILY, 1));
}

#[test]
fn settlement_after_the_oracle_stops_counts_only_max_gap() {
    let mut env = with_history();
    env.create_series(DAILY, 0).unwrap();
    let key = series_pda(DAILY, 0);
    let s: Series = read(&env.svm, &key);
    // the oracle stops; settle long after expiry
    let late = s.expiry_ts + 10 * 86_400;
    env.set_time(late);
    env.settle(key).unwrap();
    let settled: Series = read(&env.svm, &key);
    // MAX_GAP after the last update is still counted at the last price
    assert_eq!(settled.avg, 310_000);
    assert!(settled.coverage_ppm > 0 && settled.coverage_ppm < 1_000_000);
}
