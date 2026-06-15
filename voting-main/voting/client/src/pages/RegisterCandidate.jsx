// Import React state so the component can store input text and messages
import { useState } from "react";

// Import wallet and connection hooks from the Solana wallet adapter
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

// Import helpers to connect to the Anchor program and derive the needed PDA accounts
import {
  getProgram,
  getElectionStatePda,
  getCandidatePda,
  getCandidateMarkerPda,
  // getUserCreditsPda,
  getVoterProfilePda,
  SystemProgram,
} from "../utils/program";

// Component that lets a connected wallet register as a candidate
export default function RegisterCandidate() {
  // Gets the connected wallet
  const wallet = useWallet();

  // Gets the current Solana connection
  const { connection } = useConnection();

  // Stores the candidate name or manifesto entered by the user
  const [candidateInfo, setCandidateInfo] = useState("");

  // Stores success or error messages shown on the page
  const [message, setMessage] = useState("");

  // Calls the registerCandidate instruction on the Anchor program
  async function registerCandidate() {
    try {
      // Create the Anchor program client using the connected wallet and connection
      const program = getProgram(wallet, connection);

      // Get the main election state PDA
      const electionState = getElectionStatePda();

      // Fetch the current election state from the blockchain
      const election = await program.account.electionState.fetch(electionState);

      // Get the active poll id from the election state
      const pollId = election.pollId;

      // Call the registerCandidate instruction on-chain
      const tx = await program.methods
        .registerCandidate(pollId, candidateInfo)
        .accounts({
          // The connected wallet is the authority registering as a candidate
          authority: wallet.publicKey,

          // The main election state account for the current poll
          electionStateAccount: electionState,

          // The candidate PDA that will store this candidate's details and vote count
          candidateAccount: getCandidatePda(pollId, wallet.publicKey),

          // Marker account used to show this wallet is already a candidate
          candidateMarkerAccount: getCandidateMarkerPda(
            pollId,
            wallet.publicKey
          ),

          // Optional user credits PDA if credits are added back later
          // userCreditsAccount: getUserCreditsPda(wallet.publicKey),

          // Voter profile PDA is passed so the program can check this wallet is not already a voter
          voterProfileAccount: getVoterProfilePda(pollId, wallet.publicKey),

          // Required because the candidate and marker accounts are created
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Show the transaction signature after success
      setMessage(`Candidate registered. Tx: ${tx}`);
    } catch (err) {
      // Log the full error for debugging
      console.error(err);

      // Show the error message on the page
      setMessage(err.message);
    }
  }

  return (
    <div className="card">
      <h1>Register Candidate</h1>

      <input
        value={candidateInfo}
        onChange={(e) => setCandidateInfo(e.target.value)}
        placeholder="Candidate name or manifesto"
      />

      <button onClick={registerCandidate}>Register Candidate</button>

      {message && <p className="message">{message}</p>}
    </div>
  );
}