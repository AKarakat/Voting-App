// Import React state so the component can store form values, messages, and loading state
import { useState } from "react";

// Import PublicKey so the candidate wallet address can be checked
import { PublicKey } from "@solana/web3.js";

// Import wallet and connection hooks from the Solana wallet adapter
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

// Import helpers to connect to the Anchor program and derive the commitment PDA
import {
  getProgram,
  getElectionStatePda,
  getCommitmentRecordPda,
  SystemProgram,
} from "../utils/program";

// Import blind-signature helpers
// These help create a private voting token and prove it was signed without exposing it during signing
import {
  createBlindCredential,
  unblindSignature,
} from "../utils/blindSignature";

// Component that lets a connected wallet commit a private vote
export default function VotePage() {
  // Gets the connected wallet
  const wallet = useWallet();

  // Gets the current Solana connection
  const { connection } = useConnection();

  // Stores the candidate wallet address entered by the voter
  const [candidateWallet, setCandidateWallet] = useState("");

  // Stores the candidate id entered by the voter
  const [candidateId, setCandidateId] = useState("");

  // Stores success or error messages shown on the page
  const [message, setMessage] = useState("");

  // Tracks whether the vote process is currently running
  const [loading, setLoading] = useState(false);

  // Creates a blind credential, prepares a hidden vote commitment, and sends commitVote on-chain
  async function vote() {
    try {
      // Show loading while the vote process runs
      setLoading(true);

      // Clear any old message
      setMessage("");

      // Make sure the voter has connected a wallet
      if (!wallet.publicKey) {
        setMessage("Please connect your wallet first.");
        return;
      }

      // Make sure the voter entered the candidate details
      if (!candidateWallet || !candidateId) {
        setMessage("Please enter candidate wallet and candidate ID.");
        return;
      }

      // Create the Anchor program client using the connected wallet and connection
      const program = getProgram(wallet, connection);

      // Get the main election state PDA
      const electionState = getElectionStatePda();

      // Fetch the election state so we know which poll the vote belongs to
      const election = await program.account.electionState.fetch(electionState);

      // Get the active poll id from the election state
      const pollId = election.pollId;

      // Check that the candidate wallet input is a valid Solana public key
      new PublicKey(candidateWallet.trim());

      //4b Creates the blind credential before committing the vote
      const credential = await createBlindCredential();

      //5b Ask the backend to sign the blinded token
      // The backend sees the wallet for eligibility and poll id so it can limit one credential per wallet per poll
      // The backend does not see the real private token because only the blinded token is sent
      const signResponse = await fetch("http://localhost:5000/request-credential", {
        method: "POST", // Send data to the backend
        headers: {
          "Content-Type": "application/json", // Tell the backend the body is JSON
        },
        body: JSON.stringify({
          walletAddress: wallet.publicKey.toBase58(), // The connected voter's wallet address
          pollId: pollId.toString(), // The current poll id
          blindedToken: credential.blindedTokenHex, // The hidden token that the backend signs
        }),
      });

      // Read the backend signing response
      const signData = await signResponse.json();

      // Stop if the backend refused or failed to sign the credential
      if (!signResponse.ok) {
        throw new Error(signData.error || "Failed to request credential");
      }

      // Unblind the backend's signed blinded token
      // This creates a valid signature for the real private token
      // The signature can prove the token is valid without linking it directly to the wallet request
      const signatureHex = unblindSignature(
        signData.signedBlindedToken, // The backend's signature over the blinded token
        credential.rInverseHex, // The value used to remove the blinding
        credential.nHex // The RSA modulus used in the unblinding maths
      );
      
      //1c
      // Ask the backend to verify the credential and prepare for hidden vote commitment  
      // The backend creates the nullifier, commitment, and stores the nonce for reveal later
      const commitResponse = await fetch("http://localhost:5000/prepare-commit", {
        method: "POST", // Send data to the backend
        headers: {
          "Content-Type": "application/json", // Tell the backend the body is JSON
        },
        body: JSON.stringify({
          token: credential.tokenHex, // The private token created by the frontend
          signature: signatureHex, // The unblinded signature proving the token is valid
          pollId: pollId.toString(), // The current poll id
          candidateId: candidateId.toString(), // The candidate the voter chose
          candidateWallet: candidateWallet.trim(), // The chosen candidate's wallet address
        }),
      });
      
      // The frontend sends only the nullifier and commitment to the smart contract
      //  The actual candidate ID and nonce are not sent during commit
      const commitData = await commitResponse.json();

      // Stop if the backend failed to prepare the commitment
      if (!commitResponse.ok) {
        throw new Error(commitData.error || "Failed to prepare commit");
      }

      // Convert the nullifier from hex into bytes
      // The nullifier helps stop the same credential being used twice
      const nullifier = Buffer.from(commitData.nullifier, "hex");

      // Convert the commitment from hex into bytes
      // The commitment hides the candidate choice until the reveal phase
      const commitment = Buffer.from(commitData.commitment, "hex");

      // Derive the commitment record PDA expected by the smart contract
      // The PDA uses the poll id and nullifier, so the same nullifier cannot create two commit records
      const commitmentRecordAccount = getCommitmentRecordPda(
        pollId, // The current poll id used in the PDA seeds
        nullifier // The vote nullifier used in the PDA seeds
      );

      // Send the commitVote instruction to the Anchor program
      // This stores the hidden vote commitment on-chain without revealing the candidate yet
      const commitTx = await program.methods
        .commitVote(
          Array.from(nullifier), // The nullifier passed to the smart contract
          Array.from(commitment) // The hidden vote commitment passed to the smart contract
        )
        .accounts({
          relayer: wallet.publicKey, // The connected wallet submits and pays for the commit transaction
          electionStateAccount: electionState, // The main election state account
          commitmentRecordAccount, // The PDA account that stores the hidden commitment
          systemProgram: SystemProgram.programId, // Required because the commitment record account is created
        })
        .rpc();

      // Show the transaction signature after success
      setMessage(
        `Vote committed successfully. It will be revealed by the backend after voting ends. Commit Tx: ${commitTx}`
      );
    } catch (err) {
      // Log the full error for debugging
      console.error(err);

      // Show a readable error message on the page
      setMessage(err.message || "Vote failed.");
    } finally {
      // Turn loading off whether the vote succeeded or failed
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1>Vote</h1>

      <p>Enter the candidate wallet address and candidate ID.</p>

      <input
        value={candidateWallet}
        onChange={(e) => setCandidateWallet(e.target.value)}
        placeholder="Candidate wallet address"
      />

      <input
        type="number"
        value={candidateId}
        onChange={(e) => setCandidateId(e.target.value)}
        placeholder="Candidate ID"
      />

      <button onClick={vote} disabled={loading}>
        {loading ? "Committing vote..." : "Commit Vote"}
      </button>

      {message && <p className="message">{message}</p>}
    </div>
  );
}