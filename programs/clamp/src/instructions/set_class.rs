use anchor_lang::prelude::*;

use crate::constants::{
    CLASS_SEED, CONFIG_SEED, MAX_HALF_WIDTH_PPM, MAX_REPORTERS, MAX_SOURCES, MAX_STEP_PPM_LIMIT,
};
use crate::errors::ClampError;
use crate::state::{ClassConfig, Config, Source};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClassParams {
    pub name: [u8; 16],
    pub enabled: bool,
    pub reporters: Vec<Pubkey>,
    pub min_reporters: u8,
    /// Must equal the stored sources when the class already exists.
    pub sources: Vec<Source>,
    pub min_sources: u8,
    pub min_total_weight: u8,
    pub min_price: u64,
    pub max_price: u64,
    pub max_step_ppm: u32,
    pub half_width_ppm: [u32; 3],
}

/// Creates or updates a class (spec 13: admin only).
#[derive(Accounts)]
#[instruction(class_id: u8)]
pub struct SetClass<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + ClassConfig::INIT_SPACE,
        seeds = [CLASS_SEED, &[class_id]],
        bump
    )]
    pub class_config: Box<Account<'info, ClassConfig>>,
    pub system_program: Program<'info, System>,
}

fn validate(p: &ClassParams) -> Result<()> {
    let reporters = p.reporters.len();
    require!(
        (1..=MAX_REPORTERS).contains(&reporters),
        ClampError::InvalidClassParams
    );
    for (i, r) in p.reporters.iter().enumerate() {
        require!(*r != Pubkey::default(), ClampError::InvalidClassParams);
        require!(
            !p.reporters[..i].contains(r),
            ClampError::InvalidClassParams
        );
    }
    require!(
        p.min_reporters >= 1 && usize::from(p.min_reporters) <= reporters,
        ClampError::InvalidClassParams
    );

    let sources = p.sources.len();
    require!(
        (1..=MAX_SOURCES).contains(&sources),
        ClampError::InvalidClassParams
    );
    for (i, s) in p.sources.iter().enumerate() {
        require!(s.source_id >= 1, ClampError::InvalidClassParams);
        require!(
            !p.sources[..i].iter().any(|o| o.source_id == s.source_id),
            ClampError::InvalidClassParams
        );
        if !s.has_capacity {
            require!(
                (1..=2).contains(&s.fixed_weight),
                ClampError::InvalidClassParams
            );
        }
    }
    require!(
        p.min_sources >= 1 && usize::from(p.min_sources) <= sources,
        ClampError::InvalidClassParams
    );
    require!(p.min_total_weight >= 1, ClampError::InvalidClassParams);
    require!(
        p.min_price > 0 && p.min_price < p.max_price,
        ClampError::InvalidClassParams
    );
    require!(
        p.max_step_ppm >= 1 && p.max_step_ppm <= MAX_STEP_PPM_LIMIT,
        ClampError::InvalidClassParams
    );
    require!(
        p.half_width_ppm
            .iter()
            .all(|w| *w >= 1 && *w <= MAX_HALF_WIDTH_PPM),
        ClampError::InvalidClassParams
    );
    Ok(())
}

pub fn handle_set_class(ctx: Context<SetClass>, class_id: u8, params: ClassParams) -> Result<()> {
    require!(class_id >= 1, ClampError::InvalidClassId);
    validate(&params)?;

    let class = &mut ctx.accounts.class_config;
    let mut sources = [Source::default(); MAX_SOURCES];
    sources[..params.sources.len()].copy_from_slice(&params.sources);

    if class.class_id == 0 {
        class.class_id = class_id;
        class.bump = ctx.bumps.class_config;
        class.sources = sources;
        class.source_count = params.sources.len() as u8;
    } else {
        require!(
            class.source_count as usize == params.sources.len() && class.sources == sources,
            ClampError::SourcesLocked
        );
    }

    let mut reporters = [Pubkey::default(); MAX_REPORTERS];
    reporters[..params.reporters.len()].copy_from_slice(&params.reporters);

    class.name = params.name;
    class.enabled = params.enabled;
    class.reporters = reporters;
    class.reporter_count = params.reporters.len() as u8;
    class.min_reporters = params.min_reporters;
    class.min_sources = params.min_sources;
    class.min_total_weight = params.min_total_weight;
    class.min_price = params.min_price;
    class.max_price = params.max_price;
    class.max_step_ppm = params.max_step_ppm;
    class.half_width_ppm = params.half_width_ppm;
    Ok(())
}
