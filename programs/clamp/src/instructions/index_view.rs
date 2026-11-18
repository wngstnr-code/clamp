//! Reading the class index at a past time (spec 6.3) from the zero-copy ring.

use anchor_lang::prelude::*;

use crate::constants::{MAX_GAP, OBS_CARDINALITY};
use crate::errors::ClampError;
use crate::math::twap::{find_at_or_before_by, oldest_slot_of, sums_at, Observation, Sums};
use crate::state::{IndexState, Observations};

/// Where the sums of a time were taken from.
pub enum SumsSource {
    /// The last observation at or before the time.
    Exact,
    /// The ring no longer reaches back: the oldest stored observation.
    Oldest,
}

/// Running sums of the class index at time `x`.
///
/// Uses the last stored observation with `ts <= x`. When the ring no longer
/// reaches back that far, uses the oldest stored observation as it is (spec 11,
/// "use the oldest observation still stored"). `None` before the first update.
pub fn sums_at_time(
    index: &IndexState,
    observations: &Observations,
    x: i64,
) -> Result<Option<(Sums, SumsSource)>> {
    if index.update_count == 0 {
        return Ok(None);
    }
    let newest = usize::from(index.obs_index);
    let count = usize::from(index.obs_count);
    let found = find_at_or_before_by(
        |i| observations.items[i].ts,
        OBS_CARDINALITY,
        newest,
        count,
        x,
    );
    let (slot, source) = match found {
        Some(slot) => (slot, SumsSource::Exact),
        None => {
            let oldest = oldest_slot_of(OBS_CARDINALITY, newest, count)
                .ok_or(ClampError::MathInvalidInput)?;
            (oldest, SumsSource::Oldest)
        }
    };
    let obs = Observation::from(&observations.items[slot]);
    let sums = match source {
        SumsSource::Exact => sums_at(&obs, x, MAX_GAP).map_err(ClampError::from)?,
        SumsSource::Oldest => Sums {
            cum_price: obs.cum_price,
            cum_valid: obs.cum_valid,
        },
    };
    Ok(Some((sums, source)))
}
