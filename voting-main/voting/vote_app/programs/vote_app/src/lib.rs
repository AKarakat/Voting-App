use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

mod contexts;
mod errors;
mod events;
mod state;

use contexts::*;
use errors::*;
use events::*;
use state::*;

declare_id!("2uQA8d8LujCRnCBhTVaDRipa2NshWRmyJAD6sr96knjY");

// The shortest amount of time a phase can last
const MIN_PHASE_DURATION_SECS: i64 = 60;

// The longest amount of time a phase can last == 1 week
const MAX_PHASE_DURATION_SECS: i64 = 60 * 60 * 24 * 7;

#[program]
pub mod vote_app {
    use super::*;

    // Starts a new poll
    // Sets the admin, poll times, counters, and result fields
    pub fn start_poll(
        ctx: Context<StartPoll>,
        candidate_registration_secs: i64,
        voting_secs: i64,
    ) -> Result<()> {
        // Gets the current Unix time from the Solana clock
        let now = Clock::get()?.unix_timestamp;

        // Gets the election state account so it can be changed
        let election = &mut ctx.accounts.election_state_account;

        // Checks that the candidate sign up time is not too short or too long
        require!(
            candidate_registration_secs >= MIN_PHASE_DURATION_SECS
                && candidate_registration_secs <= MAX_PHASE_DURATION_SECS,
            VoteError::InvalidDuration
        );

        // Checks that the voting time is not too short or too long
        require!(
            voting_secs >= MIN_PHASE_DURATION_SECS
                && voting_secs <= MAX_PHASE_DURATION_SECS,
            VoteError::InvalidDuration
        );

        // If the election account has already been set up before
        if election.bump != 0 {
            // Makes sure there is no active poll still running
            // A new poll can only start if the old one is finalised or finished
            require!(
                !election.is_active || election.is_finalized || now >= election.voting_end,
                VoteError::PollAlreadyActive
            );

            // Makes sure only the admin can start the next poll
            require!(
                election.admin == ctx.accounts.authority.key(),
                VoteError::AdminOnly
            );
        } else {
            // If this is the first poll, save the caller as the admin
            election.admin = ctx.accounts.authority.key();
        }

        // Creates the next poll id
        // If adding fails, it falls back to poll id 1
        let new_poll_id = election.poll_id.checked_add(1).unwrap_or(1);

        // Stores the new poll id
        election.poll_id = new_poll_id;

        // Marks the poll as active
        election.is_active = true;

        // Marks the poll as not finalised
        election.is_finalized = false;

        // Candidate sign up starts now
        election.candidate_registration_start = now;

        // Candidate sign up ends after the chosen sign up length
        election.candidate_registration_end = now
            .checked_add(candidate_registration_secs)
            .ok_or(VoteError::InvalidDuration)?;

        // Voting starts straight after candidate sign up ends
        election.voting_start = election.candidate_registration_end;

        // Voting ends after the chosen voting length
        election.voting_end = election
            .voting_start
            .checked_add(voting_secs)
            .ok_or(VoteError::InvalidDuration)?;

        // Resets poll counters for the new poll
        election.total_candidates = 0;
        election.total_registered_voters = 0;
        election.total_committed_votes = 0;
        election.total_votes_cast = 0;

        // Clears old winner data from the last poll
        election.winning_candidate_id = 0;
        election.winning_candidate_wallet = Pubkey::default();
        election.winning_candidate_info = String::new();
        election.winning_votes = 0;
        election.is_tie = false;

        // Stores the PDA bump for the election state account
        election.bump = ctx.bumps.election_state_account;

        // Emits an event so off-chain apps can see that the poll started
        emit!(PollStarted {
            poll_id: election.poll_id,
            admin: election.admin,
            candidate_registration_start: election.candidate_registration_start,
            candidate_registration_end: election.candidate_registration_end,
            voting_start: election.voting_start,
            voting_end: election.voting_end,
            timestamp: now,
        });

        Ok(())
    }

    // Registers the caller as a voter
    // A wallet cannot register as a voter if it is already a candidate
    pub fn register_voter(ctx: Context<RegisterVoter>) -> Result<()> {
        // Gets the current Unix time
        let now = Clock::get()?.unix_timestamp;

        // Gets the election state account so it can be read and changed
        let election = &mut ctx.accounts.election_state_account;

        // Makes sure the poll has been set up
        require!(election.bump != 0, VoteError::PollNotInitialized);

        // Makes sure there is an active poll
        require!(election.is_active, VoteError::NoActivePoll);

        // Makes sure voter sign up is still allowed
        require!(now < election.voting_end, VoteError::VoterRegistrationClosed);

        // Makes sure this wallet is not already a candidate
        require!(
            ctx.accounts.candidate_marker_account.data_is_empty(),
            VoteError::CandidateCannotBeVoter
        );

        // Gets the voter profile account so it can be changed
        let voter = &mut ctx.accounts.voter_profile_account;

        // Stops the same wallet registering twice
        if voter.wallet != Pubkey::default() && voter.is_registered {
            return err!(VoteError::VoterAlreadyRegistered);
        }

        // Stores the voter wallet
        voter.wallet = ctx.accounts.authority.key();

        // Marks this profile as registered
        voter.is_registered = true;

        // Saves the time the voter registered
        voter.registered_at = now;

        // Stores the PDA bump for the voter profile account
        voter.bump = ctx.bumps.voter_profile_account;

        // Adds one to the total number of registered voters
        election.total_registered_voters = election
            .total_registered_voters
            .checked_add(1)
            .ok_or(VoteError::CandidateVotesOverflow)?;

        // Emits an event so off-chain apps can see the voter was registered
        emit!(VoterRegistered {
            wallet: voter.wallet,
            total_registered_voters: election.total_registered_voters,
            timestamp: now,
        });

        Ok(())
    }

    // Registers the caller as a candidate
    // A wallet cannot register as a candidate if it is already a voter
    pub fn register_candidate(
        ctx: Context<RegisterCandidate>,
        poll_id: u64,
        candidate_info: String,
    ) -> Result<()> {
        // Gets the current Unix time
        let now = Clock::get()?.unix_timestamp;

        // Gets the election state account so it can be read and changed
        let election = &mut ctx.accounts.election_state_account;

        // Makes sure the poll has been set up
        require!(election.bump != 0, VoteError::PollNotInitialized);

        // Makes sure there is an active poll
        require!(election.is_active, VoteError::NoActivePoll);

        // Makes sure the given poll id matches the active poll
        require!(election.poll_id == poll_id, VoteError::PollNotInitialized);

        // Makes sure candidate sign up is currently open
        require!(
            is_candidate_registration_open(election, now),
            VoteError::CandidateRegistrationNotOpen
        );

        // Makes sure this wallet is not already a voter
        require!(
            ctx.accounts.voter_profile_account.data_is_empty(),
            VoteError::VoterCannotBeCandidate
        );

        // Creates the next candidate id
        let candidate_id = election
            .total_candidates
            .checked_add(1)
            .ok_or(VoteError::CandidateVotesOverflow)?;

        // Gets the candidate account so it can be filled in
        let candidate = &mut ctx.accounts.candidate_account;

        // Stores which poll this candidate belongs to
        candidate.poll_id = election.poll_id;

        // Stores the new candidate id
        candidate.candidate_id = candidate_id;

        // Stores the candidate wallet
        candidate.candidate_wallet = ctx.accounts.authority.key();

        // Starts the candidate with zero votes
        candidate.vote_count = 0;

        // Stores the candidate details
        candidate.candidate_info = candidate_info.clone();

        // Stores the PDA bump for the candidate account
        candidate.bump = ctx.bumps.candidate_account;

        // Gets the marker account so it can show this wallet is a candidate
        let marker = &mut ctx.accounts.candidate_marker_account;

        // Stores the poll id in the marker
        marker.poll_id = election.poll_id;

        // Stores the candidate wallet in the marker
        marker.wallet = ctx.accounts.authority.key();

        // Stores the PDA bump for the marker account
        marker.bump = ctx.bumps.candidate_marker_account;

        // Updates the total number of candidates
        election.total_candidates = candidate_id;

        // Emits an event so off-chain apps can see the candidate was registered
        emit!(CandidateRegistered {
            poll_id: election.poll_id,
            candidate_id,
            candidate_wallet: candidate.candidate_wallet,
            candidate_info,
            timestamp: now,
        });

        Ok(())
    }
    
    // Commits a hidden vote
    // This stores a commitment without showing the chosen candidate yet
    pub fn commit_vote(
        ctx: Context<CommitVote>,
        nullifier: [u8; 32],
        commitment: [u8; 32],
    ) -> Result<()> {
        // Gets the current Unix time
        let now = Clock::get()?.unix_timestamp;

        // Gets the election state account so it can be read and changed
        let election = &mut ctx.accounts.election_state_account;

        // Makes sure the poll has been set up
        require!(election.bump != 0, VoteError::PollNotInitialized);

        // Makes sure there is an active poll
        require!(election.is_active, VoteError::NoActivePoll);

        // Makes sure the poll has not already been finalised
        require!(!election.is_finalized, VoteError::PollAlreadyFinalized);

        // Makes sure voting is currently open
        require!(is_voting_open(election, now), VoteError::VotingNotOpen);

        // Gets the commitment record account so it can be filled in
        let record = &mut ctx.accounts.commitment_record_account;
        
        //7c Extension of state.rs 
        // Stores the poll id for this commitment
        record.poll_id = election.poll_id;

        // Stores the nullifier used to stop duplicate votes
        record.nullifier = nullifier;

        // Stores the hidden vote commitment
        record.commitment = commitment;

        // Marks the vote as not revealed yet
        record.revealed = false;

        // Sets candidate id to zero until the reveal step
        record.candidate_id = 0;

        // Saves the time the vote was committed
        record.committed_at = now;

        // Sets reveal time to zero until the vote is revealed
        record.revealed_at = 0;

        // Stores the PDA bump for the commitment record
        record.bump = ctx.bumps.commitment_record_account;

        // Adds one to the total number of committed votes
        election.total_committed_votes = election
            .total_committed_votes
            .checked_add(1)
            .ok_or(VoteError::CandidateVotesOverflow)?;

        // Emits an event so off-chain apps can see the vote was committed
        emit!(VoteCommitted {
            poll_id: election.poll_id,
            nullifier,
            commitment,
            total_committed_votes: election.total_committed_votes,
            timestamp: now,
        });

        Ok(())
    }

    // Reveals a previously committed vote
    // The program checks that the revealed vote matches the old commitment
    pub fn reveal_vote(
        ctx: Context<RevealVote>,
        candidate_id: u64,
        nullifier: [u8; 32],
        nonce: [u8; 32],
    ) -> Result<()> {
        // Gets the current Unix time
        let now = Clock::get()?.unix_timestamp;

        // Gets the election state account so it can be read and changed
        let election = &mut ctx.accounts.election_state_account;

        // Makes sure the poll has been set up
        require!(election.bump != 0, VoteError::PollNotInitialized);

        // Makes sure there is an active poll
        require!(election.is_active, VoteError::NoActivePoll);

        // Makes sure the poll has not already been finalised
        require!(!election.is_finalized, VoteError::PollAlreadyFinalized);

        // Gets the candidate account that should receive the vote
        let candidate = &mut ctx.accounts.candidate_account;

        // Makes sure the candidate belongs to this poll
        require!(candidate.poll_id == election.poll_id, VoteError::InvalidCandidate);

        // Makes sure the candidate id matches the input
        require!(candidate.candidate_id == candidate_id, VoteError::InvalidCandidate);

        // Gets the old commitment record
        let record = &mut ctx.accounts.commitment_record_account;

        // Makes sure this commitment has not already been revealed
        require!(!record.revealed, VoteError::VoteAlreadyRevealed);

        // Converts the poll id into bytes for hashing
        let poll_id_bytes = election.poll_id.to_le_bytes();

        // Converts the candidate id into bytes for hashing
        let candidate_id_bytes = candidate_id.to_le_bytes();

        //8c Contract recomputes the hash using the revealed candid nonce 
        // Checked against the stored commitment == Valid Vote 
        // Creates a new SHA256 hasher
        let mut hasher = Sha256::new();

        // Adds a fixed text label so the hash is clearly for vote commitments
        hasher.update(b"vote-commitment");

        // Adds the poll id to the hash
        hasher.update(poll_id_bytes.as_ref());

        // Adds the candidate id to the hash
        hasher.update(candidate_id_bytes.as_ref());

        // Adds the private nonce to the hash
        hasher.update(nonce.as_ref());

        // Creates the commitment from the revealed data
        let computed_commitment: [u8; 32] = hasher.finalize().into();

        // Checks that the newly created commitment matches the stored one
        require!(
            computed_commitment == record.commitment,
            VoteError::InvalidReveal
        );

        //9c 
        // Once verified 
        // Marks the commitment as revealed
        record.revealed = true;

        // Stores which candidate received the vote
        record.candidate_id = candidate_id;

        // Saves the time the vote was revealed
        record.revealed_at = now;

        // Adds one vote to the chosen candidate
        candidate.vote_count = candidate
            .vote_count
            .checked_add(1)
            .ok_or(VoteError::CandidateVotesOverflow)?;

        // Adds one to the total number of votes cast
        election.total_votes_cast = election
            .total_votes_cast
            .checked_add(1)
            .ok_or(VoteError::CandidateVotesOverflow)?;

        // Emits an event so off-chain apps can see the vote was revealed
        emit!(VoteRevealed {
            poll_id: election.poll_id,
            nullifier,
            candidate_id,
            candidate_total_votes: candidate.vote_count,
            timestamp: now,
        });

        Ok(())
    }

    // Ends the poll and works out the winner
    // The admin must pass every candidate account as remaining accounts
    pub fn finalize_poll<'info>(
        ctx: Context<'_, '_, 'info, 'info, FinalizePoll<'info>>,
    ) -> Result<()> {
        // Gets the current Unix time
        let now = Clock::get()?.unix_timestamp;

        // Gets the election state account so it can be changed
        let election = &mut ctx.accounts.election_state_account;

        // Makes sure the poll has been set up
        require!(election.bump != 0, VoteError::PollNotInitialized);

        // Makes sure only the admin can finalise the poll
        require!(election.admin == ctx.accounts.authority.key(), VoteError::AdminOnly);

        // Makes sure there is an active poll
        require!(election.is_active, VoteError::NoActivePoll);

        // Makes sure the poll has not already been finalised
        require!(!election.is_finalized, VoteError::PollAlreadyFinalized);

        // Makes sure the voting end time has passed
        require!(now >= election.voting_end, VoteError::PollStillActive);

        // Makes sure at least one vote was cast
        require!(election.total_votes_cast > 0, VoteError::NoVotesCast);

        // Makes sure every candidate account was passed in
        require!(
            ctx.remaining_accounts.len() as u64 == election.total_candidates,
            VoteError::MissingCandidateAccounts
        );

        // Stores the current winning candidate id while checking all candidates
        let mut winning_candidate_id: u64 = 0;

        // Stores the current winning candidate wallet
        let mut winning_candidate_wallet = Pubkey::default();

        // Stores the current winning candidate details
        let mut winning_candidate_info = String::new();

        // Stores the highest vote count found so far
        let mut winning_votes: u64 = 0;

        // Tracks whether more than one candidate has the top vote count
        let mut is_tie = false;

        // Loops through every candidate account passed as a remaining account
        for candidate_account_info in ctx.remaining_accounts.iter() {
            // Converts the raw account info into a typed candidate account
            let candidate: Account<CandidateRegistration> =
                Account::try_from(candidate_account_info)?;

            // Makes sure this candidate belongs to the active poll
            require!(candidate.poll_id == election.poll_id, VoteError::InvalidCandidate);

            //10c
            // Finalisation != reveal votes
            // It checks for the votes that have already been counted 
            // Stores winner + Closes the poll
            // If this candidate has more votes than the current winner
            if candidate.vote_count > winning_votes {
                // Save this candidate as the current winner
                winning_candidate_id = candidate.candidate_id;
                winning_candidate_wallet = candidate.candidate_wallet;
                winning_candidate_info = candidate.candidate_info.clone();
                winning_votes = candidate.vote_count;

                // Clear the tie flag because this candidate is ahead
                is_tie = false;
            } else if candidate.vote_count == winning_votes && candidate.vote_count > 0 {
                // If another candidate has the same top vote count, mark it as a tie
                is_tie = true;
            }
        }

        // Stores the winning candidate id in the election state
        election.winning_candidate_id = winning_candidate_id;

        // Stores the winning candidate wallet in the election state
        election.winning_candidate_wallet = winning_candidate_wallet;

        // Stores the winning candidate details in the election state
        election.winning_candidate_info = winning_candidate_info;

        // Stores the winning vote count in the election state
        election.winning_votes = winning_votes;

        // Stores whether the poll ended in a tie
        election.is_tie = is_tie;

        // Marks the poll as no longer active
        election.is_active = false;

        // Marks the poll as finalised
        election.is_finalized = true;

        // Emits an event so off-chain apps can see the final result
        emit!(PollFinalized {
            poll_id: election.poll_id,
            winner_candidate_id: election.winning_candidate_id,
            winner_wallet: election.winning_candidate_wallet,
            winner_info: election.winning_candidate_info.clone(),
            winning_votes: election.winning_votes,
            is_tie: election.is_tie,
            timestamp: now,
        });

        Ok(())
    }
}

// Checks whether candidate sign up is currently open
fn is_candidate_registration_open(election: &ElectionState, now: i64) -> bool {
    now >= election.candidate_registration_start && now < election.candidate_registration_end
}

// Checks whether voting is currently open
fn is_voting_open(election: &ElectionState, now: i64) -> bool {
    now >= election.voting_start && now < election.voting_end
}