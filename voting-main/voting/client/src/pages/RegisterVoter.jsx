import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  getProgram,
  getElectionStatePda,
  getVoterProfilePda,
  // getUserCreditsPda,
  getCandidateMarkerPda,
  SystemProgram,
} from "../utils/program";

export default function RegisterVoter() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [message, setMessage] = useState("");

  async function registerVoter() {
    try {
      const program = getProgram(wallet, connection);
      const electionState = getElectionStatePda();

      const election = await program.account.electionState.fetch(electionState);
      const pollId = election.pollId;

      const tx = await program.methods
        .registerVoter()
        .accounts({
          authority: wallet.publicKey,
          electionStateAccount: electionState,
          voterProfileAccount: getVoterProfilePda(pollId, wallet.publicKey),
          // userCreditsAccount: getUserCreditsPda(wallet.publicKey),
          candidateMarkerAccount: getCandidateMarkerPda(
            pollId,
            wallet.publicKey
          ),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setMessage(`Voter registered. Tx: ${tx}`);
    } catch (err) {
      console.error(err);
      setMessage(err.message);
    }
  }

  return (
    <div className="card">
      <h1>Register Voter</h1>
      <button onClick={registerVoter}>Register as Voter</button>
      {message && <p className="message">{message}</p>}
    </div>
  );
}