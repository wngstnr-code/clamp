//! Instruction tests for the Clamp Index (spec 6, 13): initialize, set_class,
//! init_index, submit_report. Runs the built program in LiteSVM.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    clamp::{
        instructions::{ClassParams, InitializeParams},
        state::{ClassConfig, Config, IndexState, ObservationSlot, Observations, Source},
        MAX_SOURCES, OBS_CARDINALITY,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const CLASS: u8 = 1;
const T0: i64 = 1_800_000_000;
const NO_HASHES: [[u8; 32]; MAX_SOURCES] = [[0u8; 32]; MAX_SOURCES];

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    mint: Pubkey,
    treasury: Pubkey,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &clamp::id()).0
}
fn config_pda() -> Pubkey {
    pda(&[b"config"])
}
fn class_pda(id: u8) -> Pubkey {
    pda(&[b"class", &[id]])
}
fn index_pda(id: u8) -> Pubkey {
    pda(&[b"index", &[id]])
}
fn program_data() -> Pubkey {
    Pubkey::find_program_address(&[clamp::id().as_ref()], &bpf_loader_upgradeable::id()).0
}

fn send(
    svm: &mut LiteSVM,
    ix: Instruction,
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<u64, String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend_from_slice(signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
    svm.send_transaction(tx)
        .map(|meta| meta.compute_units_consumed)
        .map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs))
}

/// The call failed with the named Anchor error (custom or constraint).
#[track_caller]
fn assert_err(result: Result<u64, String>, name: &str) {
    match result {
        Ok(_) => panic!("expected error {name}, got success"),
        Err(e) => assert!(e.contains(name), "expected error {name}, got: {e}"),
    }
}

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = ts;
    clock.slot += 1;
    svm.set_sysvar(&clock);
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).expect("account exists");
    T::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

fn read_obs(svm: &LiteSVM, key: &Pubkey, slot: usize) -> ObservationSlot {
    let acc = svm.get_account(key).unwrap();
    let start = 8 + slot * core::mem::size_of::<ObservationSlot>();
    *bytemuck::from_bytes(&acc.data[start..start + core::mem::size_of::<ObservationSlot>()])
}

fn put_raw(svm: &mut LiteSVM, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
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

/// SPL Token mint, 6 decimals, packed by hand (82 bytes).
fn mint_data(authority: &Pubkey) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = 6;
    d[45] = 1;
    d
}

/// SPL Token account, packed by hand (165 bytes).
fn token_account_data(mint: &Pubkey, owner: &Pubkey) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[108] = 1;
    d
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/clamp.so"));
    svm.add_program(clamp::id(), bytes).unwrap();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();

    // LiteSVM loads programs without an upgrade authority. Set it to the admin.
    let pd = program_data();
    let mut acc = svm.get_account(&pd).unwrap();
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(pd, acc).unwrap();

    let token_program = anchor_spl::token::ID;
    let mint = Pubkey::new_unique();
    let treasury = Pubkey::new_unique();
    put_raw(&mut svm, mint, token_program, mint_data(&admin.pubkey()));
    put_raw(
        &mut svm,
        treasury,
        token_program,
        token_account_data(&mint, &admin.pubkey()),
    );
    set_time(&mut svm, T0);
    Env {
        svm,
        admin,
        mint,
        treasury,
    }
}

fn initialize_ix(
    mint: Pubkey,
    treasury: Pubkey,
    signer: &Pubkey,
    params: InitializeParams,
) -> Instruction {
    Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::Initialize { params }.data(),
        clamp::accounts::Initialize {
            admin: *signer,
            config: config_pda(),
            collateral_mint: mint,
            treasury,
            program: clamp::id(),
            program_data: program_data(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn default_init() -> InitializeParams {
    InitializeParams {
        trade_fee_bps: 100,
        protocol_share_bps: 2_000,
        series_alloc_bps: 1_000,
    }
}

/// RTX 4090 sources: Vast.ai and Akash by capacity, RunPod fixed 2, Nosana fixed 1.
fn sources() -> Vec<Source> {
    vec![
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
    ]
}

fn class_params(reporters: &[Pubkey], min_reporters: u8) -> ClassParams {
    let mut name = [0u8; 16];
    name[..8].copy_from_slice(b"RTX 4090");
    ClassParams {
        name,
        enabled: true,
        reporters: reporters.to_vec(),
        min_reporters,
        sources: sources(),
        min_sources: 2,
        min_total_weight: 3,
        min_price: 50_000,
        max_price: 5_000_000,
        max_step_ppm: 100_000,
        half_width_ppm: [100_000, 150_000, 200_000],
    }
}

fn set_class_ix(admin: &Pubkey, class_id: u8, params: ClassParams) -> Instruction {
    Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::SetClass { class_id, params }.data(),
        clamp::accounts::SetClass {
            admin: *admin,
            config: config_pda(),
            class_config: class_pda(class_id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn init_index_ix(admin: &Pubkey, class_id: u8, observations: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::InitIndex { class_id }.data(),
        clamp::accounts::InitIndex {
            admin: *admin,
            config: config_pda(),
            class_config: class_pda(class_id),
            index_state: index_pda(class_id),
            observations,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// A report with a (dummy, non-zero) raw hash for every price above 0, as the
/// real reporters send it.
fn report_ix(
    reporter: &Pubkey,
    class_id: u8,
    observations: Pubkey,
    prices: [u64; MAX_SOURCES],
    capacities: [u32; MAX_SOURCES],
) -> Instruction {
    let mut hashes = NO_HASHES;
    for (h, p) in hashes.iter_mut().zip(prices) {
        if p > 0 {
            *h = [7u8; 32];
        }
    }
    report_ix_with_hashes(reporter, class_id, observations, prices, capacities, hashes)
}

fn report_ix_with_hashes(
    reporter: &Pubkey,
    class_id: u8,
    observations: Pubkey,
    prices: [u64; MAX_SOURCES],
    capacities: [u32; MAX_SOURCES],
    raw_hashes: [[u8; 32]; MAX_SOURCES],
) -> Instruction {
    Instruction::new_with_bytes(
        clamp::id(),
        &clamp::instruction::SubmitReport {
            class_id,
            prices,
            capacities,
            raw_hashes,
        }
        .data(),
        clamp::accounts::SubmitReport {
            reporter: *reporter,
            class_config: class_pda(class_id),
            index_state: index_pda(class_id),
            observations,
        }
        .to_account_metas(None),
    )
}

/// A zeroed account of the right size owned by the program, as the setup
/// script creates it on devnet.
fn new_observations(env: &mut Env, size: usize) -> Pubkey {
    let key = Pubkey::new_unique();
    put_raw(&mut env.svm, key, clamp::id(), vec![0u8; size]);
    key
}

struct Ready {
    env: Env,
    reporters: Vec<Keypair>,
    obs: Pubkey,
}

/// Initialized config, class 1 with `n` reporters and quorum `min`, index bound.
fn ready(n: usize, min: u8) -> Ready {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    send(
        &mut env.svm,
        initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
        &admin,
        &[],
    )
    .unwrap();
    let reporters: Vec<Keypair> = (0..n).map(|_| Keypair::new()).collect();
    for r in &reporters {
        env.svm.airdrop(&r.pubkey(), 1_000_000_000).unwrap();
    }
    let keys: Vec<Pubkey> = reporters.iter().map(|r| r.pubkey()).collect();
    send(
        &mut env.svm,
        set_class_ix(&admin.pubkey(), CLASS, class_params(&keys, min)),
        &admin,
        &[],
    )
    .unwrap();
    let obs = new_observations(&mut env, Observations::SIZE);
    send(
        &mut env.svm,
        init_index_ix(&admin.pubkey(), CLASS, obs),
        &admin,
        &[],
    )
    .unwrap();
    Ready {
        env,
        reporters,
        obs,
    }
}

fn report(
    r: &mut Ready,
    who: usize,
    prices: [u64; MAX_SOURCES],
    caps: [u32; MAX_SOURCES],
) -> Result<u64, String> {
    let reporter = r.reporters[who].insecure_clone();
    let ix = report_ix(&reporter.pubkey(), CLASS, r.obs, prices, caps);
    send(&mut r.env.svm, ix, &reporter, &[])
}

fn index(r: &Ready) -> IndexState {
    read(&r.env.svm, &index_pda(CLASS))
}

/// Vast 0.30 (40 offers, w2), RunPod 0.34 (w2), Akash 0.32 (3 GPUs, w1), Nosana 0.29 (w1).
const P: [u64; MAX_SOURCES] = [300_000, 340_000, 320_000, 290_000, 0, 0];
const C: [u32; MAX_SOURCES] = [40, 0, 3, 0, 0, 0];

// ---------------------------------------------------------------- initialize

#[test]
fn initialize_only_by_upgrade_authority_and_once() {
    let mut env = setup();
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = initialize_ix(env.mint, env.treasury, &stranger.pubkey(), default_init());
    assert_err(send(&mut env.svm, ix, &stranger, &[]), "ConstraintRaw");

    let admin = env.admin.insecure_clone();
    send(
        &mut env.svm,
        initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
        &admin,
        &[],
    )
    .unwrap();
    let config: Config = read(&env.svm, &config_pda());
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.collateral_mint, env.mint);
    assert_eq!(config.treasury, env.treasury);
    assert_eq!(config.trade_fee_bps, 100);

    assert_err(
        send(
            &mut env.svm,
            initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
            &admin,
            &[],
        ),
        "already in use",
    );
}

#[test]
fn initialize_rejects_bad_params_and_treasury() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    for bad in [
        InitializeParams {
            trade_fee_bps: 1_001,
            ..default_init()
        },
        InitializeParams {
            protocol_share_bps: 10_001,
            ..default_init()
        },
        InitializeParams {
            series_alloc_bps: 0,
            ..default_init()
        },
        InitializeParams {
            series_alloc_bps: 10_001,
            ..default_init()
        },
    ] {
        assert_err(
            send(
                &mut env.svm,
                initialize_ix(env.mint, env.treasury, &admin.pubkey(), bad),
                &admin,
                &[],
            ),
            "InvalidFeeParams",
        );
    }
    // treasury of another mint
    let other_mint = Pubkey::new_unique();
    put_raw(
        &mut env.svm,
        other_mint,
        anchor_spl::token::ID,
        mint_data(&admin.pubkey()),
    );
    let wrong = Pubkey::new_unique();
    put_raw(
        &mut env.svm,
        wrong,
        anchor_spl::token::ID,
        token_account_data(&other_mint, &admin.pubkey()),
    );
    env.treasury = wrong;
    assert_err(
        send(
            &mut env.svm,
            initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
            &admin,
            &[],
        ),
        "TreasuryMintMismatch",
    );
}

// ---------------------------------------------------------------- set_class

#[test]
fn set_class_validates_params_and_admin() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    send(
        &mut env.svm,
        initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
        &admin,
        &[],
    )
    .unwrap();
    let r = [Pubkey::new_unique(), Pubkey::new_unique()];
    let ok = class_params(&r, 1);

    let bad: Vec<ClassParams> = vec![
        ClassParams {
            reporters: vec![],
            ..ok.clone()
        },
        ClassParams {
            reporters: vec![r[0]; 2],
            ..ok.clone()
        },
        ClassParams {
            reporters: vec![Pubkey::default()],
            ..ok.clone()
        },
        ClassParams {
            reporters: (0..6).map(|_| Pubkey::new_unique()).collect(),
            ..ok.clone()
        },
        ClassParams {
            min_reporters: 0,
            ..ok.clone()
        },
        ClassParams {
            min_reporters: 3,
            ..ok.clone()
        },
        ClassParams {
            sources: vec![],
            ..ok.clone()
        },
        ClassParams {
            sources: vec![sources()[0]; 2],
            ..ok.clone()
        },
        ClassParams {
            sources: vec![Source {
                source_id: 0,
                has_capacity: true,
                fixed_weight: 0,
            }],
            min_sources: 1,
            ..ok.clone()
        },
        ClassParams {
            sources: vec![Source {
                source_id: 2,
                has_capacity: false,
                fixed_weight: 0,
            }],
            min_sources: 1,
            ..ok.clone()
        },
        ClassParams {
            min_sources: 0,
            ..ok.clone()
        },
        ClassParams {
            min_sources: 5,
            ..ok.clone()
        },
        ClassParams {
            min_total_weight: 0,
            ..ok.clone()
        },
        ClassParams {
            min_price: 0,
            ..ok.clone()
        },
        ClassParams {
            min_price: 5_000_000,
            ..ok.clone()
        },
        ClassParams {
            max_step_ppm: 0,
            ..ok.clone()
        },
        ClassParams {
            max_step_ppm: 500_001,
            ..ok.clone()
        },
        ClassParams {
            half_width_ppm: [0, 1, 1],
            ..ok.clone()
        },
        ClassParams {
            half_width_ppm: [1, 1, 900_001],
            ..ok.clone()
        },
    ];
    for p in bad {
        assert_err(
            send(
                &mut env.svm,
                set_class_ix(&admin.pubkey(), CLASS, p),
                &admin,
                &[],
            ),
            "InvalidClassParams",
        );
    }
    // class id 0 is reserved
    assert_err(
        send(
            &mut env.svm,
            set_class_ix(&admin.pubkey(), 0, ok.clone()),
            &admin,
            &[],
        ),
        "InvalidClassId",
    );
    // not the admin
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert_err(
        send(
            &mut env.svm,
            set_class_ix(&stranger.pubkey(), CLASS, ok.clone()),
            &stranger,
            &[],
        ),
        "ConstraintHasOne",
    );

    send(
        &mut env.svm,
        set_class_ix(&admin.pubkey(), CLASS, ok),
        &admin,
        &[],
    )
    .unwrap();
    let class: ClassConfig = read(&env.svm, &class_pda(CLASS));
    assert_eq!(class.class_id, CLASS);
    assert_eq!(class.reporter_count, 2);
    assert_eq!(class.source_count, 4);
    assert_eq!(&class.reporters[..2], &r);
}

#[test]
fn set_class_updates_reporters_but_not_sources() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    send(
        &mut env.svm,
        initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
        &admin,
        &[],
    )
    .unwrap();
    let a = Pubkey::new_unique();
    send(
        &mut env.svm,
        set_class_ix(&admin.pubkey(), CLASS, class_params(&[a], 1)),
        &admin,
        &[],
    )
    .unwrap();

    let b = Pubkey::new_unique();
    send(
        &mut env.svm,
        set_class_ix(&admin.pubkey(), CLASS, class_params(&[a, b], 2)),
        &admin,
        &[],
    )
    .unwrap();
    let class: ClassConfig = read(&env.svm, &class_pda(CLASS));
    assert_eq!(class.reporter_count, 2);
    assert_eq!(class.min_reporters, 2);

    let mut changed = class_params(&[a, b], 2);
    changed.sources[1].fixed_weight = 1;
    assert_err(
        send(
            &mut env.svm,
            set_class_ix(&admin.pubkey(), CLASS, changed),
            &admin,
            &[],
        ),
        "SourcesLocked",
    );
    let mut fewer = class_params(&[a, b], 2);
    fewer.sources.pop();
    fewer.min_sources = 2;
    assert_err(
        send(
            &mut env.svm,
            set_class_ix(&admin.pubkey(), CLASS, fewer),
            &admin,
            &[],
        ),
        "SourcesLocked",
    );
}

// ---------------------------------------------------------------- init_index

#[test]
fn init_index_binds_a_correct_ring_once() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    send(
        &mut env.svm,
        initialize_ix(env.mint, env.treasury, &admin.pubkey(), default_init()),
        &admin,
        &[],
    )
    .unwrap();
    send(
        &mut env.svm,
        set_class_ix(
            &admin.pubkey(),
            CLASS,
            class_params(&[Pubkey::new_unique()], 1),
        ),
        &admin,
        &[],
    )
    .unwrap();

    let small = new_observations(&mut env, Observations::SIZE - 40);
    assert_err(
        send(
            &mut env.svm,
            init_index_ix(&admin.pubkey(), CLASS, small),
            &admin,
            &[],
        ),
        "InvalidObservationsAccount",
    );

    // owned by another program
    let foreign = Pubkey::new_unique();
    put_raw(
        &mut env.svm,
        foreign,
        system_program::ID,
        vec![0u8; Observations::SIZE],
    );
    assert_err(
        send(
            &mut env.svm,
            init_index_ix(&admin.pubkey(), CLASS, foreign),
            &admin,
            &[],
        ),
        "AccountOwnedByWrongProgram",
    );

    // a class that does not exist
    let obs2 = new_observations(&mut env, Observations::SIZE);
    assert_err(
        send(
            &mut env.svm,
            init_index_ix(&admin.pubkey(), 2, obs2),
            &admin,
            &[],
        ),
        "AccountNotInitialized",
    );

    let obs = new_observations(&mut env, Observations::SIZE);
    send(
        &mut env.svm,
        init_index_ix(&admin.pubkey(), CLASS, obs),
        &admin,
        &[],
    )
    .unwrap();
    let state: IndexState = read(&env.svm, &index_pda(CLASS));
    assert_eq!(state.observations, obs);
    assert_eq!(state.class_id, CLASS);
    assert_eq!(state.update_count, 0);

    let obs3 = new_observations(&mut env, Observations::SIZE);
    assert_err(
        send(
            &mut env.svm,
            init_index_ix(&admin.pubkey(), CLASS, obs3),
            &admin,
            &[],
        ),
        "already in use",
    );
}

// ---------------------------------------------------------------- submit_report

#[test]
fn first_report_sets_weighted_median_without_step_limit() {
    let mut r = ready(1, 1);
    let cu = report(&mut r, 0, P, C).unwrap();
    // an update with four sources must stay far below the 200k default budget
    assert!(
        cu < 100_000,
        "submit_report with an update used {cu} compute units"
    );
    println!("submit_report with update: {cu} CU");
    let s = index(&r);
    // sorted 0.29 (w1), 0.30 (w2), 0.32 (w1), 0.34 (w2): running 1, 3 = half of 6,
    // so the average of 0.30 and 0.32
    assert_eq!(s.update_count, 1);
    assert_eq!(s.last_price, 310_000);
    assert_eq!(s.last_ts, T0);
    assert_eq!((s.cum_price, s.cum_valid), (0, 0));
    assert_eq!((s.obs_index, s.obs_count), (0, 1));
    assert!(s.reports[0].used);
    let o = read_obs(&r.env.svm, &r.obs, 0);
    assert_eq!((o.ts, o.price, o.cum_valid), (T0, 310_000, 0));
}

#[test]
fn interval_and_step_limit() {
    let mut r = ready(1, 1);
    report(&mut r, 0, P, C).unwrap();

    // 5 minutes later: stored, no update
    set_time(&mut r.env.svm, T0 + 300);
    let high = [900_000, 900_000, 900_000, 900_000, 0, 0];
    report(&mut r, 0, high, C).unwrap();
    let s = index(&r);
    assert_eq!(s.update_count, 1);
    assert_eq!(s.reports[0].ts, T0 + 300);
    assert!(!s.reports[0].used);

    // 10 minutes after the first update: the stored report counts, capped at +10%
    set_time(&mut r.env.svm, T0 + 600);
    report(&mut r, 0, high, C).unwrap();
    let s = index(&r);
    assert_eq!(s.update_count, 2);
    assert_eq!(s.last_price, 341_000);
    assert_eq!(s.cum_price, 310_000u128 * 600);
    assert_eq!(s.cum_valid, 600);
    assert_eq!((s.obs_index, s.obs_count), (1, 2));

    // and down by at most 10%
    set_time(&mut r.env.svm, T0 + 1_200);
    let low = [60_000, 60_000, 60_000, 60_000, 0, 0];
    report(&mut r, 0, low, C).unwrap();
    assert_eq!(index(&r).last_price, 306_900);
}

#[test]
fn reject_unregistered_disabled_and_unused_slots() {
    let mut r = ready(1, 1);
    let stranger = Keypair::new();
    r.env
        .svm
        .airdrop(&stranger.pubkey(), 1_000_000_000)
        .unwrap();
    let ix = report_ix(&stranger.pubkey(), CLASS, r.obs, P, C);
    assert_err(send(&mut r.env.svm, ix, &stranger, &[]), "NotReporter");

    // a price in slot 5, which the class does not use
    let mut extra = P;
    extra[5] = 300_000;
    assert_err(report(&mut r, 0, extra, C), "InvalidReport");
    let mut extra_cap = C;
    extra_cap[4] = 1;
    assert_err(report(&mut r, 0, P, extra_cap), "InvalidReport");

    // the observation ring of another class: valid account, wrong binding
    let admin = r.env.admin.insecure_clone();
    let reporter = r.reporters[0].insecure_clone();
    send(
        &mut r.env.svm,
        set_class_ix(&admin.pubkey(), 2, class_params(&[reporter.pubkey()], 1)),
        &admin,
        &[],
    )
    .unwrap();
    let other = new_observations(&mut r.env, Observations::SIZE);
    send(
        &mut r.env.svm,
        init_index_ix(&admin.pubkey(), 2, other),
        &admin,
        &[],
    )
    .unwrap();
    let ix = report_ix(&reporter.pubkey(), CLASS, other, P, C);
    assert_err(send(&mut r.env.svm, ix, &reporter, &[]), "ConstraintHasOne");
    // a fresh zeroed account is not an observation ring at all
    let blank = new_observations(&mut r.env, Observations::SIZE);
    let ix = report_ix(&reporter.pubkey(), CLASS, blank, P, C);
    assert_err(
        send(&mut r.env.svm, ix, &reporter, &[]),
        "AccountDiscriminatorMismatch",
    );

    // disabled class
    let mut p = class_params(&[reporter.pubkey()], 1);
    p.enabled = false;
    send(
        &mut r.env.svm,
        set_class_ix(&admin.pubkey(), CLASS, p),
        &admin,
        &[],
    )
    .unwrap();
    assert_err(report(&mut r, 0, P, C), "ClassDisabled");
    assert_eq!(index(&r).update_count, 0);
}

#[test]
fn quorum_of_two_takes_median_per_source() {
    let mut r = ready(2, 2);
    report(&mut r, 0, P, C).unwrap();
    assert_eq!(index(&r).update_count, 0, "one report is not a quorum");

    set_time(&mut r.env.svm, T0 + 60);
    let p2 = [320_000, 340_000, 0, 310_000, 0, 0];
    let c2 = [44, 0, 0, 0, 0, 0];
    report(&mut r, 1, p2, c2).unwrap();
    let s = index(&r);
    assert_eq!(
        s.update_count, 1,
        "both registered reporters are fresh: no wait"
    );
    // Vast 0.31 (cap 42, w2), RunPod 0.34 (w2), Akash only one report (left out),
    // Nosana 0.30 (w1). Sorted 0.30 w1, 0.31 w2, 0.34 w2: running 1, 3 > 2.5 -> 0.31
    assert_eq!(s.last_price, 310_000);
    assert!(s.reports[0].used && s.reports[1].used);

    // used reports are not reused; one new report is not a quorum
    set_time(&mut r.env.svm, T0 + 700);
    report(&mut r, 0, P, C).unwrap();
    assert_eq!(index(&r).update_count, 1);
    // a second fresh report completes the quorum
    report(&mut r, 1, P, C).unwrap();
    assert_eq!(index(&r).update_count, 2);
}

/// Spec 6.2 step 2 (D-055): with three reporters the update waits for the
/// third, so the median per source is formed from three reports.
#[test]
fn update_waits_for_every_reporter_then_one_liar_cannot_move_the_median() {
    let mut r = ready(3, 2);
    report(&mut r, 0, P, C).unwrap();
    set_time(&mut r.env.svm, T0 + 300);
    // reporter 1 lies: every price at the $5 upper bound
    let liar = [5_000_000, 5_000_000, 5_000_000, 5_000_000, 0, 0];
    report(&mut r, 1, liar, C).unwrap();
    assert_eq!(
        index(&r).update_count,
        0,
        "two of three fresh: wait for the third"
    );
    set_time(&mut r.env.svm, T0 + 600);
    report(&mut r, 2, P, C).unwrap();
    let s = index(&r);
    assert_eq!(s.update_count, 1);
    // each source: median of (honest, liar, honest) = honest
    assert_eq!(s.last_price, 310_000);
}

#[test]
fn a_missing_reporter_delays_the_update_by_at_most_report_wait() {
    let mut r = ready(3, 2);
    report(&mut r, 0, P, C).unwrap();
    set_time(&mut r.env.svm, T0 + 300);
    report(&mut r, 1, P, C).unwrap();
    assert_eq!(index(&r).update_count, 0);
    // reporter 0 reports again: its new report is fresh, the oldest fresh one
    // (reporter 1, T0 + 300) is 599 s old: still waiting
    set_time(&mut r.env.svm, T0 + 899);
    report(&mut r, 0, P, C).unwrap();
    assert_eq!(index(&r).update_count, 0);
    // at 600 s the two fresh reports form the update without reporter 2
    set_time(&mut r.env.svm, T0 + 900);
    report(&mut r, 0, P, C).unwrap();
    let s = index(&r);
    assert_eq!(s.update_count, 1);
    assert_eq!(s.last_price, 310_000);
}

#[test]
fn a_price_without_a_raw_hash_is_refused() {
    let mut r = ready(1, 1);
    let reporter = r.reporters[0].insecure_clone();
    let mut hashes = [[7u8; 32]; MAX_SOURCES];
    hashes[1] = [0u8; 32]; // RunPod has a price but no hash
    let ix = report_ix_with_hashes(&reporter.pubkey(), CLASS, r.obs, P, C, hashes);
    assert_err(send(&mut r.env.svm, ix, &reporter, &[]), "MissingRawHash");
    // a source that did not answer: price 0 and no hash is fine
    let mut p = P;
    p[1] = 0;
    let ix = report_ix_with_hashes(&reporter.pubkey(), CLASS, r.obs, p, C, hashes);
    send(&mut r.env.svm, ix, &reporter, &[]).unwrap();
    assert_eq!(index(&r).update_count, 1);
}

#[test]
fn stale_reports_are_ignored() {
    let mut r = ready(2, 2);
    report(&mut r, 0, P, C).unwrap();
    set_time(&mut r.env.svm, T0 + 901);
    report(&mut r, 1, P, C).unwrap();
    assert_eq!(index(&r).update_count, 0);
    // within the window of each other: counts
    set_time(&mut r.env.svm, T0 + 1_000);
    report(&mut r, 0, P, C).unwrap();
    assert_eq!(index(&r).update_count, 1);
}

#[test]
fn too_few_sources_or_weight_means_no_update() {
    let mut r = ready(1, 1);
    // only RunPod (w2): one source, below min_sources 2
    report(&mut r, 0, [0, 340_000, 0, 0, 0, 0], [0; MAX_SOURCES]).unwrap();
    assert_eq!(index(&r).update_count, 0);
    // Vast with 0 capacity (w0) and Nosana (w1): one counted source
    report(&mut r, 0, [300_000, 0, 0, 290_000, 0, 0], [0; MAX_SOURCES]).unwrap();
    assert_eq!(index(&r).update_count, 0);
    // Akash 2 GPUs (w1) and Nosana (w1): two sources but weight 2 < 3
    report(
        &mut r,
        0,
        [0, 0, 320_000, 290_000, 0, 0],
        [0, 0, 2, 0, 0, 0],
    )
    .unwrap();
    assert_eq!(index(&r).update_count, 0);
    // out-of-bounds prices are dropped: RunPod at $9 is ignored
    report(
        &mut r,
        0,
        [0, 9_000_000, 320_000, 290_000, 0, 0],
        [0, 0, 2, 0, 0, 0],
    )
    .unwrap();
    assert_eq!(index(&r).update_count, 0);
    // enough: RunPod (w2) and Nosana (w1)
    report(&mut r, 0, [0, 340_000, 0, 290_000, 0, 0], [0; MAX_SOURCES]).unwrap();
    assert_eq!(index(&r).last_price, 340_000);
}

#[test]
fn report_of_a_removed_reporter_does_not_count() {
    let mut r = ready(2, 2);
    report(&mut r, 0, P, C).unwrap();
    // the admin replaces reporter 0 with a new key in the same slot
    let newcomer = Keypair::new();
    r.env
        .svm
        .airdrop(&newcomer.pubkey(), 1_000_000_000)
        .unwrap();
    let admin = r.env.admin.insecure_clone();
    let keys = [newcomer.pubkey(), r.reporters[1].pubkey()];
    send(
        &mut r.env.svm,
        set_class_ix(&admin.pubkey(), CLASS, class_params(&keys, 2)),
        &admin,
        &[],
    )
    .unwrap();
    report(&mut r, 1, P, C).unwrap();
    assert_eq!(
        index(&r).update_count,
        0,
        "the old key's report must not count"
    );
    let ix = report_ix(&newcomer.pubkey(), CLASS, r.obs, P, C);
    send(&mut r.env.svm, ix, &newcomer, &[]).unwrap();
    assert_eq!(index(&r).update_count, 1);
}

#[test]
fn gap_beyond_max_gap_is_not_counted() {
    let mut r = ready(1, 1);
    report(&mut r, 0, P, C).unwrap();
    set_time(&mut r.env.svm, T0 + 50_000);
    report(&mut r, 0, P, C).unwrap();
    let s = index(&r);
    assert_eq!(s.cum_valid, 7_200);
    assert_eq!(s.cum_price, 310_000u128 * 7_200);
}

#[test]
fn ring_wraps_after_cardinality_updates() {
    let mut r = ready(1, 1);
    let total = OBS_CARDINALITY + 2;
    for i in 0..total {
        set_time(&mut r.env.svm, T0 + 600 * i as i64);
        report(&mut r, 0, P, C).unwrap();
    }
    let s = index(&r);
    assert_eq!(s.update_count, total as u64);
    assert_eq!(s.obs_count as usize, OBS_CARDINALITY);
    assert_eq!(s.obs_index as usize, (total - 1) % OBS_CARDINALITY);
    assert_eq!(s.cum_valid, 600 * (total as u64 - 1));
    assert_eq!(s.cum_price, 310_000u128 * 600 * (total as u128 - 1));
    // the newest entry overwrote slot 1, the oldest kept entry is in slot 2
    let newest = read_obs(&r.env.svm, &r.obs, 1);
    assert_eq!(newest.ts, T0 + 600 * (total as i64 - 1));
    let oldest = read_obs(&r.env.svm, &r.obs, 2);
    assert_eq!(oldest.ts, T0 + 600 * 2);
}
