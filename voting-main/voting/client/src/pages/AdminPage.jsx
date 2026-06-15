// Import React state so the page can store form values and messages
import { useState } from "react";

// Import PublicKey so text wallet addresses can be turned into Solana public keys
import { PublicKey } from "@solana/web3.js";

// Import wallet and connection hooks from the Solana wallet adapter
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

// Import helper functions used to connect to the Anchor program and find PDAs
import {
  getProgram,
  getElectionStatePda,
  getCandidatePda,
  anchor,
  SystemProgram,
} from "../utils/program";

// Admin page for starting a poll and finalising it later
export default function AdminPage() {
  // Gets the connected wallet
  const wallet = useWallet();

  // Gets the current Solana connection
  const { connection } = useConnection();

  // Stores how long candidate registration should last
  const [candidateSecs, setCandidateSecs] = useState(60);

  // Stores how long voting should last
  const [votingSecs, setVotingSecs] = useState(60);

  // Stores the text box input containing candidate wallet addresses
  const [candidateWalletsText, setCandidateWalletsText] = useState("");

  // Stores status or error messages shown on the page
  const [message, setMessage] = useState("");

  // Gets a readable error message from an Anchor or JavaScript error
  function getErrorMessage(err) {
    return (
      err?.error?.errorMessage ||
      err?.message ||
      "Transaction failed. Check console logs."
    );
  }

  // Starts a new poll by calling the startPoll instruction on the Anchor program
  async function startPoll() {
    try {
      // Make sure the admin wallet is connected before sending a transaction
      if (!wallet.publicKey) {
        setMessage("Connect wallet first.");
        return;
      }

      // Create the Anchor program client using the connected wallet and connection
      const program = getProgram(wallet, connection);

      // Get the election state PDA expected by the smart contract
      const electionState = getElectionStatePda();

      // Call the startPoll instruction on-chain
      const tx = await program.methods
        .startPoll(new anchor.BN(candidateSecs), new anchor.BN(votingSecs))
        .accounts({
          authority: wallet.publicKey,
          electionStateAccount: electionState,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Show the transaction signature after success
      setMessage(`Poll started. Tx: ${tx}`);
    } catch (err) {
      // Log the full error for debugging
      console.error(err);

      // Show a readable error message to the user
      setMessage(getErrorMessage(err));
    }
  }

  // Reveals all stored committed votes through the backend, then finalises the poll on-chain
  async function finalizePoll() {
    try {
      // Make sure the admin wallet is connected before sending a transaction
      if (!wallet.publicKey) {
        setMessage("Connect wallet first.");
        return;
      }

      // Show progress while checking the poll state
      setMessage("Checking poll and candidate accounts...");

      // Create the Anchor program client using the connected wallet and connection
      const program = getProgram(wallet, connection);

      // Get the election state PDA expected by the smart contract
      const electionState = getElectionStatePda();

      // Fetch the current election state from the blockchain
      let election = await program.account.electionState.fetch(electionState);

      // Get the active poll id from the election state
      const pollId = election.pollId;

      // Get the current time as a Unix timestamp
      const now = Math.floor(Date.now() / 1000);

      // Stop if there is no active poll
      if (!election.isActive) {
        setMessage("No active poll to finalize.");
        return;
      }

      // Stop if the poll has already been finalised
      if (election.isFinalized) {
        setMessage("This poll is already finalized.");
        return;
      }

      // Stop if voting has not ended yet
      if (now < Number(election.votingEnd)) {
        setMessage(
          `Voting has not ended yet. Voting ends at timestamp ${election.votingEnd.toString()}. Current timestamp is ${now}.`
        );
        return;
      }

      // Ask the backend to reveal all stored committed votes for this poll
      setMessage("Revealing committed votes through backend...");

      // Call the backend reveal-all route
      // This backend sends reveal_vote transactions to the Solana program
      const revealResponse = await fetch("http://localhost:5000/reveal-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pollId: pollId.toString(),
        }),
      });

      // Read the backend response
      const revealData = await revealResponse.json();

      // Stop if the backend reveal failed
      if (!revealResponse.ok) {
        throw new Error(revealData.error || "Backend reveal failed");
      }

      // Log reveal results for debugging
      console.log("Reveal results:", revealData);

      // Fetch the election state again after reveals
      // This should now include updated vote counts
      election = await program.account.electionState.fetch(electionState);

      // Stop if no votes were revealed or counted
      if (Number(election.totalVotesCast) === 0) {
        setMessage(
          "No votes have been revealed/counted yet. Check backend reveal logs."
        );
        return;
      }

      // Split the textarea into one wallet address per line
      const candidateWallets = candidateWalletsText
        .split("\n")
        .map((address) => address.trim())
        .filter(Boolean);

      // Remove duplicate wallet addresses
      const uniqueCandidateWallets = [...new Set(candidateWallets)];

      // Stop if no candidate wallets were entered
      if (uniqueCandidateWallets.length === 0) {
        setMessage("Enter all candidate wallet addresses before finalizing.");
        return;
      }

      // Stop if the number of entered wallets does not match the number of candidates on-chain
      if (uniqueCandidateWallets.length !== Number(election.totalCandidates)) {
        setMessage(
          `Candidate count mismatch. Poll has ${election.totalCandidates.toString()} candidates, but you entered ${uniqueCandidateWallets.length} wallet address(es).`
        );
        return;
      }

      // This will store all candidate PDA accounts needed by finalizePoll
      const candidateAccounts = [];

      // Check each candidate wallet address from the textarea
      for (const address of uniqueCandidateWallets) {
        // This will store the converted PublicKey
        let candidateWallet;

        try {
          // Convert the text address into a Solana PublicKey
          candidateWallet = new PublicKey(address);
        } catch {
          // Stop if the address is invalid
          setMessage(`Invalid candidate wallet address: ${address}`);
          return;
        }

        // Derive the candidate PDA from the poll id and candidate wallet
        const candidateAccount = getCandidatePda(pollId, candidateWallet);

        try {
          // Fetch the candidate account to make sure it exists
          const candidateData =
            await program.account.candidateRegistration.fetch(candidateAccount);

          // Make sure this candidate belongs to the current poll
          if (candidateData.pollId.toString() !== pollId.toString()) {
            setMessage(`Candidate ${address} does not belong to this poll.`);
            return;
          }

          // Add this candidate PDA to the final list
          candidateAccounts.push(candidateAccount);
        } catch (err) {
          // Log the full error for debugging
          console.error(err);

          // Show a helpful message if the candidate account does not exist
          setMessage(
            `Candidate account not found for wallet: ${address}. Make sure you entered the candidate wallet address, not the candidate PDA.`
          );
          return;
        }
      }

      // Tell the user the final transaction is about to be sent
      setMessage("Finalizing poll. Please approve in wallet...");

      // Call the finalizePoll instruction on-chain
      const tx = await program.methods
        .finalizePoll()
        .accounts({
          authority: wallet.publicKey,
          electionStateAccount: electionState,
        })
        .remainingAccounts(
          // Pass every candidate account to the program
          // The smart contract loops through these to find the winner
          candidateAccounts.map((pubkey) => ({
            pubkey,
            isWritable: false,
            isSigner: false,
          }))
        )
        .rpc();

      // Show the transaction signature after success
      setMessage(`Poll finalized. Tx: ${tx}`);
    } catch (err) {
      // Log the full finalise error for debugging
      console.error("Finalize failed:", err);

      // Log Anchor program logs if they are available
      if (err?.logs) {
        console.error("Program logs:", err.logs);
      }

      // Show a readable error message to the user
      setMessage(getErrorMessage(err));
    }
  }

  return (
    <div className="card">
      <h1>Admin Page</h1>

      <label>Candidate registration duration seconds</label>
      <input
        type="number"
        value={candidateSecs}
        onChange={(e) => setCandidateSecs(Number(e.target.value))}
      />

      <label>Voting duration seconds</label>
      <input
        type="number"
        value={votingSecs}
        onChange={(e) => setVotingSecs(Number(e.target.value))}
      />

      <button onClick={startPoll}>Start Poll</button>

      <hr />

      <label>Candidate wallet addresses for finalization</label>
      <textarea
        value={candidateWalletsText}
        onChange={(e) => setCandidateWalletsText(e.target.value)}
        placeholder={
          "One candidate wallet per line\nUse candidate wallet addresses, not candidate PDA addresses"
        }
        rows={5}
      />

      <button onClick={finalizePoll}>Reveal Votes & Finalize Poll</button>

      {message && <p className="message">{message}</p>}
    </div>
  );
}