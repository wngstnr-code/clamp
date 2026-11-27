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
    /// A liquidity provider with 10,000 tUSDC.
    lp: Keypair,
    mint: Pubkey,
    treasury: Pubkey,
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
    let lp = Keypair::new();
    svm.airdrop(&lp.pubkey(), 100_000_000_000).unwrap();
    let lp_collateral = get_associated_token_address(&lp.pubkey(), &mint);
    put(
        &mut svm,
        lp_collateral,
        anchor_spl::token::ID,
        token_data(&mint, &lp.pubkey(), 10_000 * USDC),
    );
    let obs = Pubkey::new_unique();
    put(&mut svm, obs, clamp::id(), vec![0u8; Observations::SIZE]);

    let mut env = Env {
        svm,
        admin,
        reporter,
        user,
        lp,
        mint,
        treasury,
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

// ================================================================ vault and pool (spec 8, 9)

use anchor_lang::solana_program::instruction::AccountMeta;
use clamp::state::Vault;

fn vault_pda() -> Pubkey {
    pda(&[b"vault"])
}
fn shares_pda() -> Pubkey {
    pda(&[b"shares"])
}
fn idle_pda() -> Pubkey {
    pda(&[b"idle"])
}

impl Env {
    fn init_vault(&mut self) {
        let admin = self.admin.insecure_clone();
        let ix = Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::InitVault {}.data(),
            clamp::accounts::InitVault {
                admin: admin.pubkey(),
                config: config_pda(),
                vault: vault_pda(),
                share_mint: shares_pda(),
                idle: idle_pda(),
                collateral_mint: self.mint,
                token_program: anchor_spl::token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, ix, &admin).unwrap();
    }

    /// Every active series and its IndexState, in vault order.
    fn active_metas(&self) -> Vec<AccountMeta> {
        let vault: Vault = read(&self.svm, &vault_pda());
        vault
            .active()
            .iter()
            .flat_map(|s| {
                [
                    AccountMeta::new_readonly(*s, false),
                    AccountMeta::new_readonly(index_pda(), false),
                ]
            })
            .collect()
    }

    fn vault_flow(
        &mut self,
        who: &Keypair,
        amount: u64,
        deposit: bool,
        extra: Vec<AccountMeta>,
    ) -> Result<u64, String> {
        let mut accounts = clamp::accounts::VaultFlow {
            user: who.pubkey(),
            vault: vault_pda(),
            share_mint: shares_pda(),
            idle: idle_pda(),
            collateral_mint: self.mint,
            user_collateral: get_associated_token_address(&who.pubkey(), &self.mint),
            user_shares: get_associated_token_address(&who.pubkey(), &shares_pda()),
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(extra);
        let data = if deposit {
            clamp::instruction::Deposit { amount }.data()
        } else {
            clamp::instruction::Withdraw { shares: amount }.data()
        };
        send(
            &mut self.svm,
            Instruction::new_with_bytes(clamp::id(), &data, accounts),
            who,
        )
    }

    fn deposit(&mut self, who: &Keypair, amount: u64) -> Result<u64, String> {
        let extra = self.active_metas();
        self.vault_flow(who, amount, true, extra)
    }

    fn withdraw(&mut self, who: &Keypair, shares: u64) -> Result<u64, String> {
        let extra = self.active_metas();
        self.vault_flow(who, shares, false, extra)
    }

    fn series_tokens(&self, series: Pubkey) -> clamp::accounts::SeriesTokens {
        clamp::accounts::SeriesTokens {
            series,
            index_state: index_pda(),
            up_mint: child(b"up", &series),
            down_mint: child(b"down", &series),
            up_vault: child(b"upv", &series),
            down_vault: child(b"downv", &series),
            collateral: child(b"collateral", &series),
            collateral_mint: self.mint,
        }
    }

    fn seed(&mut self, series: Pubkey) -> Result<u64, String> {
        let mut accounts = clamp::accounts::SeedSeries {
            config: config_pda(),
            vault: vault_pda(),
            idle: idle_pda(),
            tokens: self.series_tokens(series),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None);
        accounts.extend(self.active_metas());
        let ix = Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::SeedSeries {}.data(),
            accounts,
        );
        let user = self.user.insecure_clone();
        send(&mut self.svm, ix, &user)
    }

    /// The user's ATA of the side's mint, created by a mint + merge of 1 unit
    /// pair (the pairs instruction creates both ATAs).
    fn ensure_claim_atas(&mut self, series: Pubkey) {
        if self
            .svm
            .get_account(&get_associated_token_address(
                &self.user.pubkey(),
                &child(b"up", &series),
            ))
            .is_none()
        {
            self.pairs(series, 1, true).unwrap();
            self.pairs(series, 1, false).unwrap();
        }
    }

    fn trade(
        &mut self,
        series: Pubkey,
        side: u8,
        buy: bool,
        amount: u64,
        min: u64,
    ) -> Result<u64, String> {
        self.ensure_claim_atas(series);
        let mint = if side == 0 {
            child(b"up", &series)
        } else {
            child(b"down", &series)
        };
        let accounts = clamp::accounts::TradeAccounts {
            user: self.user.pubkey(),
            config: config_pda(),
            vault: vault_pda(),
            idle: idle_pda(),
            treasury: self.treasury,
            tokens: self.series_tokens(series),
            user_collateral: self.user_collateral(),
            user_claims: get_associated_token_address(&self.user.pubkey(), &mint),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None);
        let data = if buy {
            clamp::instruction::Buy {
                side,
                usdc_in: amount,
                min_out: min,
            }
            .data()
        } else {
            clamp::instruction::Sell {
                side,
                amount,
                min_usdc_out: min,
            }
            .data()
        };
        let user = self.user.insecure_clone();
        send(
            &mut self.svm,
            Instruction::new_with_bytes(clamp::id(), &data, accounts),
            &user,
        )
    }

    fn sweep(&mut self, series: Pubkey) -> Result<u64, String> {
        let accounts = clamp::accounts::SweepSeries {
            vault: vault_pda(),
            idle: idle_pda(),
            tokens: self.series_tokens(series),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None);
        let ix = Instruction::new_with_bytes(
            clamp::id(),
            &clamp::instruction::SweepSeries {}.data(),
            accounts,
        );
        let user = self.user.insecure_clone();
        send(&mut self.svm, ix, &user)
    }

    fn lp_shares(&self) -> u64 {
        balance(
            &self.svm,
            &get_associated_token_address(&self.lp.pubkey(), &shares_pda()),
        )
    }

    /// Every tUSDC unit in the system: wallets, idle, treasury, series collateral.
    fn total_usdc(&self, series: &[Pubkey]) -> u64 {
        let mut t = balance(&self.svm, &self.user_collateral())
            + balance(
                &self.svm,
                &get_associated_token_address(&self.lp.pubkey(), &self.mint),
            )
            + balance(&self.svm, &idle_pda())
            + balance(&self.svm, &self.treasury);
        for s in series {
            t += balance(&self.svm, &child(b"collateral", s));
        }
        t
    }
}

/// History, a daily series, a vault with 1,000 tUSDC from the LP, seeded.
fn market() -> (Env, Pubkey) {
    let mut env = with_history();
    env.init_vault();
    let lp = env.lp.insecure_clone();
    env.deposit(&lp, 1_000 * USDC).unwrap();
    env.create_series(DAILY, 0).unwrap();
    let key = series_pda(DAILY, 0);
    env.seed(key).unwrap();
    (env, key)
}

#[test]
fn deposits_and_withdrawals_price_shares_by_nav() {
    let mut env = with_history();
    env.init_vault();
    let lp = env.lp.insecure_clone();
    assert_err(env.deposit(&lp, 10 * USDC - 1), "InvalidDeposit");
    env.deposit(&lp, 500 * USDC).unwrap();
    assert_eq!(env.lp_shares(), 500 * USDC - 1_000, "1,000 units locked");
    let vault: Vault = read(&env.svm, &vault_pda());
    assert_eq!(vault.locked_shares, 1_000);
    env.deposit(&lp, 100 * USDC).unwrap();
    assert_eq!(env.lp_shares(), 600 * USDC - 1_000);
    env.withdraw(&lp, 100 * USDC).unwrap();
    assert_eq!(balance(&env.svm, &idle_pda()), 500 * USDC);
    assert_err(env.withdraw(&lp, 600 * USDC), "InvalidWithdraw");
}

#[test]
fn seed_puts_ten_percent_of_nav_into_the_pool_at_fair_value() {
    let (mut env, key) = market();
    let s: Series = read(&env.svm, &key);
    assert!(s.seeded);
    assert_eq!(s.pairs_outstanding, 100 * USDC, "10% of a 1,000 NAV");
    // the index sits at the band center, so the fair value is 0.5
    assert_eq!((s.pool_up, s.pool_down), (100 * USDC, 100 * USDC));
    assert_eq!((s.inv_up, s.inv_down), (0, 0));
    assert_eq!(balance(&env.svm, &child(b"collateral", &key)), 100 * USDC);
    assert_eq!(balance(&env.svm, &idle_pda()), 900 * USDC);
    let vault: Vault = read(&env.svm, &vault_pda());
    assert_eq!(vault.active(), &[key]);
    assert_err(env.seed(key), "AlreadySeeded");
    // the NAV still counts the seeded series: a new deposit gets shares 1 to 1
    let lp = env.lp.insecure_clone();
    let before = env.lp_shares();
    env.deposit(&lp, 100 * USDC).unwrap();
    assert_eq!(env.lp_shares() - before, 100 * USDC);
    // leaving the series out of the remaining accounts is refused
    assert_err(
        env.vault_flow(&lp, USDC, true, vec![]),
        "ActiveSeriesMismatch",
    );
}

#[test]
fn buy_and_sell_move_the_pool_keep_k_and_pay_fees() {
    let (mut env, key) = market();
    let all = [key];
    let total = env.total_usdc(&all);
    let s0: Series = read(&env.svm, &key);
    let k0 = u128::from(s0.pool_up) * u128::from(s0.pool_down);
    let idle0 = balance(&env.svm, &idle_pda());

    let cu = env.trade(key, 0, true, 10 * USDC, 1).unwrap();
    println!("buy: {cu} CU");
    let s1: Series = read(&env.svm, &key);
    let up = balance(
        &env.svm,
        &get_associated_token_address(&env.user.pubkey(), &s1.up_mint),
    );
    // spec 8.3 on a 100/100 pool: 9.9 pairs after the 1% fee,
    // out = 100 + 9.9 - ceil(100 * 100 / 109.9) = 18.908189 (slippage on a small pool)
    let new_up = (100u128 * 100 * 1_000_000_000_000).div_ceil(109_900_000);
    assert_eq!(u128::from(up), 109_900_000 - new_up);
    assert_eq!(up, 18_908_189);
    assert!(u128::from(s1.pool_up) * u128::from(s1.pool_down) >= k0);
    assert!(s1.pool_down > s1.pool_up, "UP got more expensive");
    // fee 0.1 USDC: 0.08 to the vault, 0.02 to the treasury
    assert_eq!(balance(&env.svm, &idle_pda()) - idle0, 80_000);
    assert_eq!(balance(&env.svm, &env.treasury), 20_000);
    assert_eq!(env.total_usdc(&all), total, "no tUSDC created or lost");

    let paid_back = {
        let before = balance(&env.svm, &env.user_collateral());
        env.trade(key, 0, false, up, 1).unwrap();
        balance(&env.svm, &env.user_collateral()) - before
    };
    assert!(
        paid_back < 10 * USDC,
        "a round trip never profits: {paid_back}"
    );
    let s2: Series = read(&env.svm, &key);
    assert!(u128::from(s2.pool_up) * u128::from(s2.pool_down) >= k0);
    assert_eq!(env.total_usdc(&all), total);
}

#[test]
fn trades_refuse_bad_inputs_and_closed_or_unseeded_series() {
    let (mut env, key) = market();
    assert_err(
        env.trade(key, 0, true, 10 * USDC, 100 * USDC),
        "SlippageExceeded",
    );
    assert_err(env.trade(key, 2, true, 10 * USDC, 1), "InvalidSide");
    env.create_series(1, 0).unwrap();
    let weekly = series_pda(1, 0);
    assert_err(env.trade(weekly, 0, true, 10 * USDC, 1), "NotSeeded");
    // after close_ts
    let s: Series = read(&env.svm, &key);
    env.set_time(s.close_ts);
    assert_err(env.trade(key, 0, true, 10 * USDC, 1), "TradingClosed");
}

#[test]
fn the_pool_recenters_once_per_index_update_and_pauses_near_the_bound() {
    let (mut env, key) = market();
    env.trade(key, 0, true, 10 * USDC, 1).unwrap();
    let after_trade: Series = read(&env.svm, &key);
    // the index moves up 5%: the next trade re-centers to the new fair value
    let next = env.now + 600;
    env.set_time(next);
    env.report(325_500).unwrap();
    env.trade(key, 1, true, USDC, 1).unwrap();
    let s: Series = read(&env.svm, &key);
    assert!(s.last_recenter_ts > after_trade.last_recenter_ts);
    // price_up = pool_down / (pool_up + pool_down) close to fair value 0.75
    let price =
        u128::from(s.pool_down) * 1_000_000 / (u128::from(s.pool_up) + u128::from(s.pool_down));
    assert!((700_000..800_000).contains(&price), "price {price}");
    // the index leaves the band above: the pool pauses
    for p in [358_000, 393_000] {
        let next = env.now + 600;
        env.set_time(next);
        env.report(p).unwrap();
    }
    assert_err(env.trade(key, 0, true, USDC, 1), "PoolPaused");
}

#[test]
fn settle_then_sweep_returns_the_vault_units_to_idle() {
    let (mut env, key) = market();
    env.trade(key, 0, true, 10 * USDC, 1).unwrap();
    let s: Series = read(&env.svm, &key);
    let first = env.now + 600;
    env.set_time(first);
    env.run_index(310_000, s.expiry_ts - env.now);
    // past expiry and not settled: the vault cannot be valued
    let lp = env.lp.insecure_clone();
    assert_err(env.deposit(&lp, USDC), "SeriesNeedsSettlement");
    assert_err(env.sweep(key), "NotSettled");
    env.settle(key).unwrap();
    let idle_before = balance(&env.svm, &idle_pda());
    env.sweep(key).unwrap();
    let s: Series = read(&env.svm, &key);
    assert!(s.swept && s.pool_up == 0 && s.inv_down == 0);
    let gained = balance(&env.svm, &idle_pda()) - idle_before;
    // index at the center: every claim is worth 0.5
    assert!(
        gained > 99 * USDC && gained <= 101 * USDC,
        "gained {gained}"
    );
    let vault: Vault = read(&env.svm, &vault_pda());
    assert!(vault.active().is_empty());
    assert_err(env.sweep(key), "NothingToSweep");
    // the LP can take everything that is idle now
    let shares = env.lp_shares();
    env.withdraw(&lp, shares).unwrap();
    assert!(
        balance(&env.svm, &idle_pda()) < 2_000,
        "only the locked units' value stays"
    );
}

// ---------------------------------------------------------------- locks (M3)

use clamp::state::Lock;

fn lock_pda(owner: &Pubkey, series: &Pubkey, side: u8) -> Pubkey {
    pda(&[b"lock", owner.as_ref(), series.as_ref(), &[side]])
}

fn side_mint(series: &Pubkey, side: u8) -> Pubkey {
    if side == 0 {
        child(b"up", series)
    } else {
        child(b"down", series)
    }
}

/// Arguments of `open_lock` after the side.
struct OpenArgs {
    usdc_in: u64,
    min: u64,
    hours: u32,
    ref_rate: u64,
    auto_roll: bool,
}

impl OpenArgs {
    fn buy(usdc_in: u64) -> Self {
        OpenArgs {
            usdc_in,
            min: 1,
            hours: 400,
            ref_rate: 310_000,
            auto_roll: false,
        }
    }
}

impl Env {
    fn open_lock_with(
        &mut self,
        series: Pubkey,
        side: u8,
        claim_mint: Pubkey,
        args: OpenArgs,
    ) -> Result<u64, String> {
        let owner = self.user.pubkey();
        let lock = lock_pda(&owner, &series, side);
        let accounts = clamp::accounts::OpenLock {
            owner,
            config: config_pda(),
            vault: vault_pda(),
            idle: idle_pda(),
            treasury: self.treasury,
            tokens: self.series_tokens(series),
            lock,
            claim_mint,
            escrow: child(b"escrow", &lock),
            owner_collateral: self.user_collateral(),
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        let data = clamp::instruction::OpenLock {
            side,
            usdc_in: args.usdc_in,
            min_claims_out: args.min,
            hours: args.hours,
            ref_rate: args.ref_rate,
            auto_roll: args.auto_roll,
        }
        .data();
        let user = self.user.insecure_clone();
        send(
            &mut self.svm,
            Instruction::new_with_bytes(clamp::id(), &data, accounts),
            &user,
        )
    }

    fn open_lock(&mut self, series: Pubkey, side: u8, args: OpenArgs) -> Result<u64, String> {
        self.open_lock_with(series, side, side_mint(&series, side), args)
    }

    /// `close_lock` of the user's lock, sent by `signer`, with `tokens_of`
    /// as the series accounts and `rent_payer` as the rent receiver.
    fn close_lock_with(
        &mut self,
        lock_series: Pubkey,
        tokens_of: Pubkey,
        side: u8,
        signer: &Keypair,
        rent_payer: Pubkey,
        min_usdc_out: u64,
    ) -> Result<u64, String> {
        let lock = lock_pda(&self.user.pubkey(), &lock_series, side);
        let accounts = clamp::accounts::CloseLock {
            owner: signer.pubkey(),
            config: config_pda(),
            vault: vault_pda(),
            idle: idle_pda(),
            treasury: self.treasury,
            tokens: self.series_tokens(tokens_of),
            lock,
            escrow: child(b"escrow", &lock),
            rent_payer,
            owner_collateral: self.user_collateral(),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None);
        let data = clamp::instruction::CloseLock { min_usdc_out }.data();
        send(
            &mut self.svm,
            Instruction::new_with_bytes(clamp::id(), &data, accounts),
            signer,
        )
    }

    fn close_lock(&mut self, series: Pubkey, side: u8, min_usdc_out: u64) -> Result<u64, String> {
        let user = self.user.insecure_clone();
        let payer = user.pubkey();
        self.close_lock_with(series, series, side, &user, payer, min_usdc_out)
    }

    fn withdraw_lock_claims(&mut self, series: Pubkey, side: u8) -> Result<u64, String> {
        let owner = self.user.pubkey();
        let lock = lock_pda(&owner, &series, side);
        let mint = side_mint(&series, side);
        let accounts = clamp::accounts::WithdrawLockClaims {
            owner,
            lock,
            escrow: child(b"escrow", &lock),
            claim_mint: mint,
            owner_claims: get_associated_token_address(&owner, &mint),
            rent_payer: owner,
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        let data = clamp::instruction::WithdrawLockClaims {}.data();
        let user = self.user.insecure_clone();
        send(
            &mut self.svm,
            Instruction::new_with_bytes(clamp::id(), &data, accounts),
            &user,
        )
    }

    fn set_auto_roll(
        &mut self,
        series: Pubkey,
        side: u8,
        signer: &Keypair,
        on: bool,
    ) -> Result<u64, String> {
        let lock = lock_pda(&self.user.pubkey(), &series, side);
        let accounts = clamp::accounts::SetAutoRoll {
            owner: signer.pubkey(),
            lock,
        }
        .to_account_metas(None);
        let data = clamp::instruction::SetAutoRoll { on }.data();
        send(
            &mut self.svm,
            Instruction::new_with_bytes(clamp::id(), &data, accounts),
            signer,
        )
    }

    fn user_lock(&self, series: &Pubkey, side: u8) -> Pubkey {
        lock_pda(&self.user.pubkey(), series, side)
    }

    fn escrow_of(&self, series: &Pubkey, side: u8) -> Pubkey {
        child(b"escrow", &self.user_lock(series, side))
    }

    fn stranger(&mut self) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
        k
    }
}

#[test]
fn open_lock_buys_into_the_escrow_like_a_buy_and_adds_on_a_second_call() {
    let (mut env, key) = market();
    let all = [key];
    let total = env.total_usdc(&all);
    let cu = env.open_lock(key, 0, OpenArgs::buy(10 * USDC)).unwrap();
    println!("open_lock (new lock): {cu} CU");
    let lock: Lock = read(&env.svm, &env.user_lock(&key, 0));
    let escrow = env.escrow_of(&key, 0);
    // the same pool math as the plain buy test: 18.908189 UP for 10 USDC
    assert_eq!(lock.claims, 18_908_189);
    assert_eq!(balance(&env.svm, &escrow), lock.claims);
    assert_eq!(lock.owner, env.user.pubkey());
    assert_eq!(lock.series, key);
    assert_eq!(lock.side, 0);
    assert_eq!(lock.paid, 10 * USDC);
    assert_eq!(lock.hours, 400);
    assert_eq!(lock.ref_rate, 310_000);
    assert!(!lock.auto_roll);
    assert_eq!(lock.rent_payer, env.user.pubkey());
    assert_eq!(lock.escrow, escrow);
    assert_eq!(lock.created_ts, env.now);
    // fees as for a buy: 0.08 to the vault, 0.02 to the treasury
    assert_eq!(balance(&env.svm, &env.treasury), 20_000);
    assert_eq!(env.total_usdc(&all), total, "no tUSDC created or lost");

    let cu = env
        .open_lock(
            key,
            0,
            OpenArgs {
                usdc_in: 5 * USDC,
                min: 1,
                hours: 100,
                ref_rate: 320_000,
                auto_roll: true,
            },
        )
        .unwrap();
    println!("open_lock (add): {cu} CU");
    let lock2: Lock = read(&env.svm, &env.user_lock(&key, 0));
    assert!(lock2.claims > lock.claims);
    assert_eq!(balance(&env.svm, &escrow), lock2.claims);
    assert_eq!(lock2.paid, 15 * USDC);
    assert_eq!(lock2.hours, 500);
    assert_eq!(lock2.ref_rate, 320_000);
    assert!(lock2.auto_roll);
    assert_eq!(lock2.created_ts, lock.created_ts);
    assert_eq!(env.total_usdc(&all), total);
}

#[test]
fn close_lock_before_close_sells_pays_the_owner_and_returns_the_rent() {
    let (mut env, key) = market();
    let all = [key];
    let total = env.total_usdc(&all);
    let sol0 = env.svm.get_account(&env.user.pubkey()).unwrap().lamports;
    let usdc0 = balance(&env.svm, &env.user_collateral());
    env.open_lock(key, 0, OpenArgs::buy(10 * USDC)).unwrap();
    let cu = env.close_lock(key, 0, 1).unwrap();
    println!("close_lock (sell): {cu} CU");
    let back = balance(&env.svm, &env.user_collateral()) + 10 * USDC - usdc0;
    assert!(
        back > 9 * USDC && back < 10 * USDC,
        "a round trip pays two fees and slippage: {back}"
    );
    assert!(env.svm.get_account(&env.user_lock(&key, 0)).is_none());
    assert!(env.svm.get_account(&env.escrow_of(&key, 0)).is_none());
    // only the transaction fees are gone, the rent came back
    let sol1 = env.svm.get_account(&env.user.pubkey()).unwrap().lamports;
    assert!(
        sol0 - sol1 < 100_000,
        "rent returned: spent {}",
        sol0 - sol1
    );
    assert_eq!(env.total_usdc(&all), total);
    // the lock can be opened again after a close
    env.open_lock(key, 0, OpenArgs::buy(USDC)).unwrap();
}

#[test]
fn close_lock_waits_for_settlement_then_redeems() {
    let (mut env, key) = market();
    let all = [key];
    let total = env.total_usdc(&all);
    env.open_lock(key, 0, OpenArgs::buy(10 * USDC)).unwrap();
    let claims = read::<Lock>(&env.svm, &env.user_lock(&key, 0)).claims;
    let s: Series = read(&env.svm, &key);
    env.set_time(s.close_ts);
    assert_err(env.close_lock(key, 0, 0), "LockWaitsForSettlement");
    let first = env.now + 600;
    env.set_time(first);
    env.run_index(310_000, s.expiry_ts - env.now);
    assert_err(env.close_lock(key, 0, 0), "LockWaitsForSettlement");
    env.settle(key).unwrap();
    let s: Series = read(&env.svm, &key);
    let payout = claims * u64::from(s.up_value) / 1_000_000;
    assert_err(env.close_lock(key, 0, payout + 1), "SlippageExceeded");
    let usdc0 = balance(&env.svm, &env.user_collateral());
    let cu = env.close_lock(key, 0, payout).unwrap();
    println!("close_lock (redeem): {cu} CU");
    assert_eq!(balance(&env.svm, &env.user_collateral()) - usdc0, payout);
    assert!(env.svm.get_account(&env.user_lock(&key, 0)).is_none());
    assert_eq!(env.total_usdc(&all), total);
}

#[test]
fn a_revenue_lock_buys_down_and_closes() {
    let (mut env, key) = market();
    env.open_lock(key, 1, OpenArgs::buy(10 * USDC)).unwrap();
    let lock: Lock = read(&env.svm, &env.user_lock(&key, 1));
    assert_eq!(lock.side, 1);
    let escrow = env.escrow_of(&key, 1);
    let acc = env.svm.get_account(&escrow).unwrap();
    assert_eq!(&acc.data[0..32], child(b"down", &key).as_ref());
    assert_eq!(balance(&env.svm, &escrow), lock.claims);
    // an UP lock of the same owner and series is a separate account
    env.open_lock(key, 0, OpenArgs::buy(USDC)).unwrap();
    env.close_lock(key, 1, 1).unwrap();
    assert!(env.svm.get_account(&env.user_lock(&key, 0)).is_some());
}

#[test]
fn withdraw_lock_claims_moves_them_to_the_wallet_at_any_time() {
    let (mut env, key) = market();
    env.open_lock(key, 0, OpenArgs::buy(10 * USDC)).unwrap();
    let claims = read::<Lock>(&env.svm, &env.user_lock(&key, 0)).claims;
    // between close and settlement, when close_lock waits
    let s: Series = read(&env.svm, &key);
    env.set_time(s.close_ts);
    env.withdraw_lock_claims(key, 0).unwrap();
    let ata = get_associated_token_address(&env.user.pubkey(), &s.up_mint);
    assert_eq!(balance(&env.svm, &ata), claims);
    assert!(env.svm.get_account(&env.user_lock(&key, 0)).is_none());
    assert!(env.svm.get_account(&env.escrow_of(&key, 0)).is_none());
}

#[test]
fn a_donation_to_the_escrow_cannot_block_the_close() {
    let (mut env, key) = market();
    env.ensure_claim_atas(key);
    env.trade(key, 0, true, USDC, 1).unwrap();
    env.open_lock(key, 0, OpenArgs::buy(10 * USDC)).unwrap();
    let claims = read::<Lock>(&env.svm, &env.user_lock(&key, 0)).claims;
    let owner = env.user.pubkey();
    let ata = get_associated_token_address(&owner, &child(b"up", &key));
    let gift = balance(&env.svm, &ata);
    let ix = anchor_spl::token::spl_token::instruction::transfer(
        &anchor_spl::token::ID,
        &ata,
        &env.escrow_of(&key, 0),
        &owner,
        &[],
        gift,
    )
    .unwrap();
    let user = env.user.insecure_clone();
    send(&mut env.svm, ix, &user).unwrap();
    assert_eq!(balance(&env.svm, &env.escrow_of(&key, 0)), claims + gift);
    env.close_lock(key, 0, 1).unwrap();
    assert!(env.svm.get_account(&env.escrow_of(&key, 0)).is_none());
}

#[test]
fn set_auto_roll_is_owner_only() {
    let (mut env, key) = market();
    env.open_lock(key, 0, OpenArgs::buy(USDC)).unwrap();
    let user = env.user.insecure_clone();
    env.set_auto_roll(key, 0, &user, true).unwrap();
    assert!(read::<Lock>(&env.svm, &env.user_lock(&key, 0)).auto_roll);
    env.set_auto_roll(key, 0, &user, false).unwrap();
    assert!(!read::<Lock>(&env.svm, &env.user_lock(&key, 0)).auto_roll);
    let other = env.stranger();
    assert_err(env.set_auto_roll(key, 0, &other, true), "ConstraintHasOne");
}

#[test]
fn locks_refuse_bad_inputs_strangers_and_wrong_accounts() {
    let (mut env, key) = market();
    // wrong mint for the side, bad side, slippage, zero amount
    assert_err(
        env.open_lock_with(key, 0, child(b"down", &key), OpenArgs::buy(USDC)),
        "WrongMint",
    );
    assert_err(
        env.open_lock_with(key, 2, child(b"up", &key), OpenArgs::buy(USDC)),
        "InvalidSide",
    );
    let mut greedy = OpenArgs::buy(10 * USDC);
    greedy.min = 100 * USDC;
    assert_err(env.open_lock(key, 0, greedy), "SlippageExceeded");
    assert_err(env.open_lock(key, 0, OpenArgs::buy(0)), "MathInvalidInput");
    // an unseeded series
    env.create_series(1, 0).unwrap();
    let weekly = series_pda(1, 0);
    assert_err(env.open_lock(weekly, 0, OpenArgs::buy(USDC)), "NotSeeded");

    env.open_lock(key, 0, OpenArgs::buy(10 * USDC)).unwrap();
    let user = env.user.insecure_clone();
    let me = user.pubkey();
    // a stranger cannot close it, the rent goes only to the payer, the
    // series accounts must be the lock's
    let other = env.stranger();
    assert_err(
        env.close_lock_with(key, key, 0, &other, me, 1),
        "ConstraintHasOne",
    );
    let wrong_payer = other.pubkey();
    assert_err(
        env.close_lock_with(key, key, 0, &user, wrong_payer, 1),
        "ConstraintHasOne",
    );
    assert_err(
        env.close_lock_with(key, weekly, 0, &user, me, 1),
        "WrongLockSeries",
    );
    assert_err(env.close_lock(key, 0, 100 * USDC), "SlippageExceeded");
    // after close_ts a new lock cannot be opened
    let s: Series = read(&env.svm, &key);
    env.set_time(s.close_ts);
    assert_err(env.open_lock(key, 0, OpenArgs::buy(USDC)), "TradingClosed");
}
