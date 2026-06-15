use anchor_lang::prelude::*;

#[error_code]
pub enum VoteError {
    #[msg("Poll is not initialized")]
    PollNotInitialized,

    #[msg("Only the admin can perform this action")]
    AdminOnly,

    #[msg("A poll is already active")]
    PollAlreadyActive,

    #[msg("No active poll")]
    NoActivePoll,

    #[msg("Candidate registration is not open")]
    CandidateRegistrationNotOpen,

    #[msg("Voting is not open")]
    VotingNotOpen,

    #[msg("Poll has not ended yet")]
    PollStillActive,

    #[msg("Poll already finalized")]
    PollAlreadyFinalized,

    #[msg("No votes have been cast")]
    NoVotesCast,

    #[msg("Invalid duration")]
    InvalidDuration,

    #[msg("Invalid candidate")]
    InvalidCandidate,

    #[msg("Unauthorized")]
    UnauthorizedAccess,

    #[msg("This wallet is already registered as a voter")]
    VoterAlreadyRegistered,

    #[msg("This voting credential has already been used")]
    NullifierAlreadyUsed,

    #[msg("This vote has already been revealed")]
    VoteAlreadyRevealed,

    #[msg("Reveal does not match stored commitment")]
    InvalidReveal,

    #[msg("Vote count overflow")]
    CandidateVotesOverflow,

    #[msg("A voter cannot register as a candidate")]
    VoterCannotBeCandidate,

    #[msg("A candidate cannot register as a voter")]
    CandidateCannotBeVoter,

    #[msg("Voter registration is closed")]
    VoterRegistrationClosed,

    #[msg("Missing candidate accounts")]
    MissingCandidateAccounts,
}