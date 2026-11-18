use anchor_lang::prelude::*;

use crate::constants::OBS_CARDINALITY;
use crate::math::twap::Observation;

/// One stored index update. `cum_price` is split into two `u64` halves so the
/// struct has 8-byte alignment and no padding (zero-copy safe). 40 bytes.
#[zero_copy]
#[derive(Default, Debug, PartialEq, Eq)]
pub struct ObservationSlot {
    pub ts: i64,
    pub price: u64,
    pub cum_price_lo: u64,
    pub cum_price_hi: u64,
    pub cum_valid: u64,
}

impl From<&Observation> for ObservationSlot {
    fn from(o: &Observation) -> Self {
        Self {
            ts: o.ts,
            price: o.price,
            cum_price_lo: o.cum_price as u64,
            cum_price_hi: (o.cum_price >> 64) as u64,
            cum_valid: o.cum_valid,
        }
    }
}

impl From<&ObservationSlot> for Observation {
    fn from(s: &ObservationSlot) -> Self {
        Self {
            ts: s.ts,
            price: s.price,
            cum_price: (u128::from(s.cum_price_hi) << 64) | u128::from(s.cum_price_lo),
            cum_valid: s.cum_valid,
        }
    }
}

/// Ring of index updates of one class (spec 6.3).
///
/// Not a PDA: about 80 KB is more than a program can allocate in one
/// instruction, so the setup script creates it with a fresh keypair at full
/// size, owned by this program, and `init_index` binds it to the class.
#[account(zero_copy)]
pub struct Observations {
    pub items: [ObservationSlot; OBS_CARDINALITY],
}

impl Observations {
    /// Account size including the 8-byte discriminator.
    pub const SIZE: usize = 8 + OBS_CARDINALITY * core::mem::size_of::<ObservationSlot>();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_is_40_bytes_and_round_trips_u128() {
        assert_eq!(core::mem::size_of::<ObservationSlot>(), 40);
        assert_eq!(Observations::SIZE, 8 + 2_048 * 40);
        let o = Observation {
            ts: -5,
            price: 7,
            cum_price: u128::MAX - 12_345,
            cum_valid: 99,
        };
        let back = Observation::from(&ObservationSlot::from(&o));
        assert_eq!(back, o);
    }
}
