use anchor_lang::prelude::*;

// Event emitted when a new poll is started
// This lets frontend know the poll has been created
#[event]
pub struct PollStarted {
    // Unique id for this poll
    pub poll_id: u64,

    // Wallet that started or controls the poll
    pub admin: Pubkey,

    // Time when candidate registration opens
    pub candidate_registration_start: i64,

    // Time when candidate registration closes
    pub candidate_registration_end: i64,

    // Time when voting opens
    pub voting_start: i64,

    // Time when voting closes
    pub voting_end: i64,

    // Time when this event was emitted
    pub timestamp: i64,
}

// Event emitted when a voter registers
// This helps track voter registrations off-chain
#[event]
pub struct VoterRegistered {
    pub wallet: Pubkey,
    pub total_registered_voters: u64,
    pub timestamp: i64,
}

// Event emitted when a candidate registers
// This lets off-chain apps display the new candidate
#[event]
pub struct CandidateRegistered {
    pub poll_id: u64,
    pub candidate_id: u64,
    pub candidate_wallet: Pubkey,
    pub candidate_info: String,
    pub timestamp: i64,
}

// Event emitted when a vote commitment is submitted
// This records that a hidden vote has been committed
#[event]
pub struct VoteCommitted {
    // Id of the poll this commitment belongs to
    pub poll_id: u64,

    // Unique value used to stop the same vote being used twice
    pub nullifier: [u8; 32],

    // Hidden vote commitment
    // This hides the actual vote until the reveal phase
    pub commitment: [u8; 32],

    // Updated number of committed votes
    pub total_committed_votes: u64,

    // Time when this event was emitted
    pub timestamp: i64,
}

// Event emitted when a committed vote is revealed
// This records that the vote has now been counted
#[event]
pub struct VoteRevealed {
    // Id of the poll this revealed vote belongs to
    pub poll_id: u64,

    // Same nullifier used during the commit phase
    pub nullifier: [u8; 32],

    // Candidate that received the vote
    pub candidate_id: u64,

    // Updated total votes for this candidate
    pub candidate_total_votes: u64,

    // Time when this event was emitted
    pub timestamp: i64,
}

// Event emitted when the poll is finalised
// This announces the final result of the poll
#[event]
pub struct PollFinalized {
    pub poll_id: u64,
    pub winner_candidate_id: u64,
    pub winner_wallet: Pubkey,
    pub winner_info: String,
    pub winning_votes: u64,
    pub is_tie: bool,
    pub timestamp: i64,
}