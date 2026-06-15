// Import React state so the component can store the loaded poll and messages
import { useState } from "react";

// Import wallet and connection hooks from the Solana wallet adapter
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

// Import helpers to connect to the Anchor program and find the election state PDA
import { getProgram, getElectionStatePda } from "../utils/program";

// Component that shows the current poll status from the blockchain
export default function PollStatus() {
  // Gets the connected wallet
  const wallet = useWallet();

  // Gets the current Solana connection
  const { connection } = useConnection();

  // Stores the poll data fetched from the election state account
  const [poll, setPoll] = useState(null);

  // Stores status or error messages shown on the page
  const [message, setMessage] = useState("");

  // Loads the election state account from the Solana program
  async function loadPoll() {
    try {
      // Create the Anchor program client using the wallet and connection
      const program = getProgram(wallet, connection);

      // Get the PDA address for the main election state account
      const electionState = getElectionStatePda();

      // Fetch the election state data from the blockchain
      const state = await program.account.electionState.fetch(electionState);

      // Save the fetched poll data in React state
      setPoll(state);

      // Clear any old error message
      setMessage("");
    } catch (err) {
      // Log the full error for debugging
      console.error(err);

      // Show a simple message if the election state account cannot be loaded
      setMessage("Poll not found or not initialized.");
    }
  }

  // Works out the current poll phase using the poll state and current time
  function getPhase() {
    // If no poll has been loaded yet, the phase is unknown
    if (!poll) return "Unknown";

    // Get the current Unix timestamp
    const now = Math.floor(Date.now() / 1000);

    // If the poll has been finalised, show finalised
    if (poll.isFinalized) return "Finalized";

    // If the poll is not active, show inactive
    if (!poll.isActive) return "Inactive";

    // If candidate registration has not ended yet, show candidate registration phase
    if (now < Number(poll.candidateRegistrationEnd)) {
      return "Candidate Registration";
    }

    // If voting has not ended yet, show voting phase
    if (now < Number(poll.votingEnd)) {
      return "Voting";
    }

    // If voting has ended but the admin has not finalised the poll yet
    return "Ended - Awaiting Finalization";
  }

  return (
    <section className="page-card">
      <h2>Poll Status</h2>

      <p className="page-text">
        View the current poll phase, vote count, and winner information.
      </p>

      <button className="action-button" onClick={loadPoll}>
        Load Poll
      </button>

      {message && <p className="message">{message}</p>}

      {poll && (
        <div className="poll-details">
          <p><strong>Phase:</strong> {getPhase()}</p>
          <p><strong>Poll ID:</strong> {poll.pollId.toString()}</p>
          <p><strong>Total Candidates:</strong> {poll.totalCandidates.toString()}</p>
          <p><strong>Total Registered Voters:</strong> {poll.totalRegisteredVoters.toString()}</p>
          <p><strong>Total Votes Cast:</strong> {poll.totalVotesCast.toString()}</p>

          <p>
            <strong>Winner:</strong>{" "}
            {poll.isFinalized
              ? poll.isTie
                ? "Tie"
                : poll.winningCandidateInfo || "None"
              : "Not announced yet"}
          </p>

          <p>
            <strong>Winning Votes:</strong>{" "}
            {poll.isFinalized
              ? poll.winningVotes.toString()
              : "Hidden until finalized"}
          </p>

          <p>
            <strong>Tie:</strong>{" "}
            {poll.isFinalized ? (poll.isTie ? "Yes" : "No") : "Not finalized"}
          </p>
        </div>
      )}
    </section>
  );
}