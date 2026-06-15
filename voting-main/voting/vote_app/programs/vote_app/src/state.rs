use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ElectionState {
    pub admin: Pubkey, 
    pub poll_id: u64,

    pub is_active: bool,
    pub is_finalized: bool,

    pub candidate_registration_start: i64, 
    pub candidate_registration_end: i64,
    pub voting_start: i64,
    pub voting_end: i64,

    pub total_candidates: u64,
    pub total_registered_voters: u64,
    pub total_committed_votes: u64, // Increases during commit phase  
    pub total_votes_cast: u64, // Total votes casted only increases after successful reveal

    pub winning_candidate_id: u64,
    pub winning_candidate_wallet: Pubkey,

    #[max_len(120)]
    pub winning_candidate_info: String,

    pub winning_votes: u64,
    pub is_tie: bool,

    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VoterProfile {
    pub wallet: Pubkey,
    pub is_registered: bool,
    pub registered_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CandidateRegistration {
    pub poll_id: u64,
    pub candidate_id: u64,
    pub candidate_wallet: Pubkey,
    pub vote_count: u64,

    #[max_len(120)]
    pub candidate_info: String,

    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CandidateMarker {
    pub poll_id: u64,
    pub wallet: Pubkey,
    pub bump: u8,
}

//6c Stores hidden votes revealed is false and candidate_id is 0
// After reveal, revealed becomes true and candidate_id is filled in
#[account]
#[derive(InitSpace)]
pub struct CommitmentRecord {
    pub poll_id: u64,
    pub nullifier: [u8; 32],
    pub commitment: [u8; 32],
    pub revealed: bool, 
    pub candidate_id: u64,
    pub committed_at: i64,
    pub revealed_at: i64,
    pub bump: u8,
}