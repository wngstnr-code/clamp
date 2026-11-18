//! The tUSDC faucet in LiteSVM with the real SPL Token and ATA programs.

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    anchor_spl::associated_token::get_associated_token_address,
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    test_usdc::{CLAIM_AMOUNT, COOLDOWN_SECS},
};

const T0: i64 = 1_800_000_000;

fn mint_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"mint_authority"], &test_usdc::id()).0
}
fn record(user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"faucet", user.as_ref()], &test_usdc::id()).0
}

/// SPL Token mint packed by hand (82 bytes).
fn mint_data(authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = decimals;
    d[45] = 1;
    d
}

fn put_mint(svm: &mut LiteSVM, authority: &Pubkey, decimals: u8) -> Pubkey {
    let key = Pubkey::new_unique();
    svm.set_account(
        key,
        solana_account::Account {
            lamports: 1_000_000_000,
            data: mint_data(authority, decimals),
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    key
}

fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = ts;
    clock.slot += 1;
    svm.set_sysvar(&clock);
}

fn claim(svm: &mut LiteSVM, user: &Keypair, mint: Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        test_usdc::id(),
        &test_usdc::instruction::Claim {}.data(),
        test_usdc::accounts::Claim {
            user: user.pubkey(),
            faucet_record: record(&user.pubkey()),
            mint,
            mint_authority: mint_authority(),
            user_token: get_associated_token_address(&user.pubkey(), &mint),
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs))
}

fn balance(svm: &LiteSVM, owner: &Pubkey, mint: &Pubkey) -> u64 {
    let acc = svm
        .get_account(&get_associated_token_address(owner, mint))
        .expect("token account exists");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/test_usdc.so"
    ));
    svm.add_program(test_usdc::id(), bytes).unwrap();
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    let mint = put_mint(&mut svm, &mint_authority(), 6);
    set_time(&mut svm, T0);
    (svm, user, mint)
}

#[track_caller]
fn assert_err(result: Result<(), String>, name: &str) {
    match result {
        Ok(()) => panic!("expected {name}, got success"),
        Err(e) => assert!(e.contains(name), "expected {name}, got: {e}"),
    }
}

#[test]
fn claim_mints_1000_and_creates_the_token_account() {
    let (mut svm, user, mint) = setup();
    claim(&mut svm, &user, mint).unwrap();
    assert_eq!(balance(&svm, &user.pubkey(), &mint), CLAIM_AMOUNT);
    assert_eq!(CLAIM_AMOUNT, 1_000 * 1_000_000);
}

#[test]
fn second_claim_waits_24_hours() {
    let (mut svm, user, mint) = setup();
    claim(&mut svm, &user, mint).unwrap();
    assert_err(claim(&mut svm, &user, mint), "CooldownActive");
    set_time(&mut svm, T0 + COOLDOWN_SECS - 1);
    assert_err(claim(&mut svm, &user, mint), "CooldownActive");
    set_time(&mut svm, T0 + COOLDOWN_SECS);
    claim(&mut svm, &user, mint).unwrap();
    assert_eq!(balance(&svm, &user.pubkey(), &mint), 2 * CLAIM_AMOUNT);
}

#[test]
fn every_wallet_has_its_own_limit() {
    let (mut svm, user, mint) = setup();
    let other = Keypair::new();
    svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    claim(&mut svm, &user, mint).unwrap();
    claim(&mut svm, &other, mint).unwrap();
    assert_eq!(balance(&svm, &other.pubkey(), &mint), CLAIM_AMOUNT);
}

#[test]
fn refuses_mints_it_does_not_control_or_with_other_decimals() {
    let (mut svm, user, _) = setup();
    let foreign = put_mint(&mut svm, &Pubkey::new_unique(), 6);
    assert_err(
        claim(&mut svm, &user, foreign),
        "ConstraintMintMintAuthority",
    );
    let nine = put_mint(&mut svm, &mint_authority(), 9);
    assert_err(claim(&mut svm, &user, nine), "ConstraintMintDecimals");
}
