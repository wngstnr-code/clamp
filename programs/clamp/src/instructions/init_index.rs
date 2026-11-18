use anchor_lang::prelude::*;

use crate::constants::{CLASS_SEED, CONFIG_SEED, INDEX_SEED};
use crate::errors::ClampError;
use crate::state::{ClassConfig, Config, IndexState, Observations};

/// Creates the index of a class and binds its pre-created observation ring.
#[derive(Accounts)]
#[instruction(class_id: u8)]
pub struct InitIndex<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(seeds = [CLASS_SEED, &[class_id]], bump = class_config.bump)]
    pub class_config: Box<Account<'info, ClassConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + IndexState::INIT_SPACE,
        seeds = [INDEX_SEED, &[class_id]],
        bump
    )]
    pub index_state: Box<Account<'info, IndexState>>,
    /// Fresh account of `Observations::SIZE` bytes owned by this program and
    /// still all zero (`zero` checks both and writes the discriminator).
    #[account(
        zero,
        constraint = observations.to_account_info().data_len() == Observations::SIZE
            @ ClampError::InvalidObservationsAccount
    )]
    pub observations: AccountLoader<'info, Observations>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_index(ctx: Context<InitIndex>, class_id: u8) -> Result<()> {
    ctx.accounts.observations.load_init()?;
    let index = &mut ctx.accounts.index_state;
    index.class_id = class_id;
    index.observations = ctx.accounts.observations.key();
    index.bump = ctx.bumps.index_state;
    Ok(())
}
