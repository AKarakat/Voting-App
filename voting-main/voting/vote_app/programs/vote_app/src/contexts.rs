use anchor_lang::prelude::*;

use crate::errors::*;
use crate::state::*;

// PDA 32 bit program id
// Bump used with seeds to check correct pda address

// Accounts needed to start or initialise the poll
#[derive(Accounts)]
pub struct StartPoll<'info> {
    // The wallet starting the poll
    // It must sign the transaction
    // It is mutable because it pays to create the election state account
    #[account(mut)]
    pub authority: Signer<'info>,

    // Main election state account
    // This stores the poll data
    // init_if_needed means:
    // create it if it does not exist
    // reuse it if it already exists
    // authority funds this account
    // The PDA seed is fixed: "election_state"
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + ElectionState::INIT_SPACE,
        seeds = [b"election_state"],
        bump
    )]
    pub election_state_account: Account<'info, ElectionState>,

    // Required by Solana when creating accounts
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterVoter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"election_state"],
        bump
    )]
    pub election_state_account: Account<'info, ElectionState>,

    // Each voter gets a unique PDA based on:
    // - "voter_profile"
    // - the poll id
    // - the voter's wallet address
    // init_if_needed means the account is created only if it does not exist yet
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + VoterProfile::INIT_SPACE,
        seeds = [
            b"voter_profile",
            election_state_account.poll_id.to_le_bytes().as_ref(),
            authority.key().as_ref()
        ],
        bump
    )]
    pub voter_profile_account: Account<'info, VoterProfile>,

    // This account is used only to check whether this wallet is already a candidate
    // Checks PDA address to check if it exists
    #[account(
        seeds = [
            b"candidate_marker",
            election_state_account.poll_id.to_le_bytes().as_ref(),
            authority.key().as_ref()
        ],
        bump
    )]
    /// CHECK: This is the candidate marker PDA for this poll and authority.
    /// It is unchecked because this instruction only checks whether the account exists
    /// using data_is_empty(); it does not deserialize the candidate marker data.
    pub candidate_marker_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// Accounts needed when a wallet registers as a candidate
// poll_id is passed into the instruction and used in PDA seeds and checks
#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct RegisterCandidate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    // The constraint checks that the election state's poll_id
    // matches the poll_id passed into the instruction
    #[account(
        mut,
        seeds = [b"election_state"],
        bump,
        constraint = election_state_account.poll_id == poll_id @ VoteError::PollNotInitialized
    )]
    pub election_state_account: Account<'info, ElectionState>,

    // The candidate registration account
    // Each candidate gets a unique PDA based on:
    // - "candidate"
    // - the poll id
    // - the candidate wallet address
    // init means this account must not already exist
    #[account(
        init,
        payer = authority,
        space = 8 + CandidateRegistration::INIT_SPACE,
        seeds = [
            b"candidate",
            poll_id.to_le_bytes().as_ref(),
            authority.key().as_ref()
        ],
        bump
    )]
    pub candidate_account: Account<'info, CandidateRegistration>,

    // A marker account showing this wallet is a candidate in this poll
    // This can be checked later to stop the same wallet
    // from also registering as a voter
    #[account(
        init,
        payer = authority,
        space = 8 + CandidateMarker::INIT_SPACE,
        seeds = [
            b"candidate_marker",
            poll_id.to_le_bytes().as_ref(),
            authority.key().as_ref()
        ],
        bump
    )]
    pub candidate_marker_account: Account<'info, CandidateMarker>,

    // This account is used only to check whether this wallet
    // already has a voter profile for this poll
    // It is unchecked because we only care about the PDA or existence check
    // not about loading its data
    #[account(
        seeds = [
            b"voter_profile",
            poll_id.to_le_bytes().as_ref(),
            authority.key().as_ref()
        ],
        bump
    )]
    /// CHECK: This is the voter profile PDA for this poll and authority.
    /// It is unchecked because this instruction only checks whether the account exists
    /// using data_is_empty(); it does not deserialize the voter profile data.
    pub voter_profile_account: UncheckedAccount<'info>,

    // Required because this instruction creates candidate accounts
    pub system_program: Program<'info, System>,
}

// 4c
// Accounts needed when a vote commitment is submitted
// The nullifier + pollid helps make each vote unique and prevents duplicate votes
#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
pub struct CommitVote<'info> {
    // The wallet submitting the commitment transaction
    // This may be a relayer instead of the actual voter
    // It signs and pays for the commitment record account
    #[account(mut)]
    pub relayer: Signer<'info>,

    // The main election state account
    // It is mutable because committing a vote may update election data
    #[account(
        mut,
        seeds = [b"election_state"],
        bump
    )]
    pub election_state_account: Account<'info, ElectionState>,

    // Stores the hidden vote commitment
    // The PDA is based on:
    // - "commitment"
    // - the poll id
    // - the nullifier
    // Because the nullifier is part of the PDA
    // the same nullifier cannot be used twice for the same poll
    #[account(
        init,
        payer = relayer,
        space = 8 + CommitmentRecord::INIT_SPACE,
        seeds = [
            b"commitment",
            election_state_account.poll_id.to_le_bytes().as_ref(),
            nullifier.as_ref()
        ],
        bump
    )]
    pub commitment_record_account: Account<'info, CommitmentRecord>,

    // Required because the commitment record account is created
    pub system_program: Program<'info, System>,
}

// 5c
// Loads same commitment rec using pollid+null
// Accounts needed when a committed vote is revealed and counted
#[derive(Accounts)]
#[instruction(candidate_id: u64, nullifier: [u8; 32])]
pub struct RevealVote<'info> {
    // The wallet submitting the reveal transaction
    // This may be a relayer instead of the actual voter
    #[account(mut)]
    pub relayer: Signer<'info>,

    // The main election state account
    // It is mutable because revealing a vote may update vote counts or state
    #[account(
        mut,
        seeds = [b"election_state"],
        bump
    )]
    pub election_state_account: Account<'info, ElectionState>,

    // The candidate account that receives the revealed vote
    // It is mutable because its vote count may increase
    // The first constraint checks that the candidate belongs to this poll
    // The second constraint checks that the candidate id matches the instruction input
    #[account(
        mut,
        seeds = [
            b"candidate",
            election_state_account.poll_id.to_le_bytes().as_ref(),
            candidate_account.candidate_wallet.as_ref()
        ],
        bump,
        constraint = candidate_account.poll_id == election_state_account.poll_id @ VoteError::InvalidCandidate,
        constraint = candidate_account.candidate_id == candidate_id @ VoteError::InvalidCandidate
    )]
    pub candidate_account: Account<'info, CandidateRegistration>,

    // The commitment record created during the commit phase
    // It is found using:
    // - "commitment"
    // - the poll id
    // - the same nullifier
    // It is mutable because it may be marked as revealed or used
    #[account(
        mut,
        seeds = [
            b"commitment",
            election_state_account.poll_id.to_le_bytes().as_ref(),
            nullifier.as_ref()
        ],
        bump
    )]
    pub commitment_record_account: Account<'info, CommitmentRecord>,

    pub system_program: Program<'info, System>,
}

// Accounts needed to finalise or close the poll
#[derive(Accounts)]
pub struct FinalizePoll<'info> {
    // The wallet finalising the poll
    // It must sign the transaction
    #[account(mut)]
    pub authority: Signer<'info>,

    // It is mutable because finalising the poll will update
    // the poll status winner/finalised flag
    #[account(
        mut,
        seeds = [b"election_state"],
        bump
    )]
    pub election_state_account: Account<'info, ElectionState>,
}