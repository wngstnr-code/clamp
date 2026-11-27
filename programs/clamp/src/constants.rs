//! Fixed protocol values (spec 6.4). Per-class values live in `ClassConfig`.

/// Seconds between two accepted index updates, at least.
pub const MIN_UPDATE_INTERVAL: i64 = 600;
/// Seconds counted after one observation, at most.
pub const MAX_GAP: i64 = 7_200;
/// A report older than this many seconds is ignored.
pub const REPORT_WINDOW: i64 = 900;
/// How long an update waits for the reporters that have not reported yet (D-055).
pub const REPORT_WAIT: i64 = 600;
/// Entries in the observation ring of each class.
pub const OBS_CARDINALITY: usize = 2_048;
/// Reporters per class, at most.
pub const MAX_REPORTERS: usize = 5;
/// Sources per class, at most.
pub const MAX_SOURCES: usize = 6;
/// Largest step limit an admin may set (50% per update).
pub const MAX_STEP_PPM_LIMIT: u32 = 500_000;
/// Largest band half width an admin may set (90%).
pub const MAX_HALF_WIDTH_PPM: u32 = 900_000;
/// Largest trade fee an admin may set (10%).
pub const MAX_TRADE_FEE_BPS: u16 = 1_000;
/// 10,000 basis points = 100%.
pub const BPS: u16 = 10_000;

pub const CONFIG_SEED: &[u8] = b"config";
pub const CLASS_SEED: &[u8] = b"class";
pub const INDEX_SEED: &[u8] = b"index";
pub const SERIES_SEED: &[u8] = b"series";
pub const UP_MINT_SEED: &[u8] = b"up";
pub const DOWN_MINT_SEED: &[u8] = b"down";
pub const COLLATERAL_SEED: &[u8] = b"collateral";
pub const UP_VAULT_SEED: &[u8] = b"upv";
pub const DOWN_VAULT_SEED: &[u8] = b"downv";

/// Series kinds and their durations in seconds (spec 7.1).
pub const KIND_DAILY: u8 = 0;
pub const KIND_WEEKLY: u8 = 1;
pub const KIND_MONTHLY: u8 = 2;
pub const DURATIONS: [i64; 3] = [86_400, 604_800, 2_592_000];
/// The band center is the index average of this window before creation.
pub const CENTER_WINDOW: i64 = 72 * 3_600;
/// Creation needs at least this much counted time in the center window.
pub const MIN_CENTER_COUNTED: u64 = 6 * 3_600;
/// Claims and collateral use 6 decimals.
pub const CLAIM_DECIMALS: u8 = 6;
/// Sides of a claim.
pub const SIDE_UP: u8 = 0;
pub const SIDE_DOWN: u8 = 1;
pub const LOCK_SEED: &[u8] = b"lock";
pub const ESCROW_SEED: &[u8] = b"escrow";
/// `roll_lock` refuses to pay more per claim than the fair value plus this
/// (micro-USDC per claim, D-063).
pub const ROLL_MAX_PREMIUM_PPM: u64 = 50_000;
