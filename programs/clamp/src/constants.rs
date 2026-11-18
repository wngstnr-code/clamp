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
