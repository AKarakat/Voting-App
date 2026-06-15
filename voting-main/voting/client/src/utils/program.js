// Import Anchor so the frontend can talk to the Anchor program
import * as anchor from "@coral-xyz/anchor";

// Import Solana helpers for public keys and the system program
import { PublicKey, SystemProgram } from "@solana/web3.js";

// Import the program IDL
// The IDL tells the frontend what instructions and accounts the program has
import idl from "../idl/vote_app.json";

// Get the deployed program ID from the IDL
export const PROGRAM_ID = new PublicKey(idl.address);

// Creates an Anchor program client
// This connects the user's wallet and Solana connection to the smart contract
export function getProgram(wallet, connection) {
    const provider = new anchor.AnchorProvider(
        connection,
        wallet,
        anchor.AnchorProvider.defaultOptions()
    );
    
    return new anchor.Program(idl, provider);
}

// Gets the main election state PDA
// This must match seeds = [b"election_state"] in the Anchor program
export function getElectionStatePda() {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("election_state")],
        PROGRAM_ID
    )[0];
}

// Gets the voter profile PDA for a specific poll and wallet
// This is the account that stores voter registration data
export function getVoterProfilePda(pollId, wallet){
    const pollBuffer = new anchor.BN(pollId).toArrayLike(Buffer, "le", 8);

    return PublicKey.findProgramAddressSync(
        [Buffer.from("voter_profile"), pollBuffer, wallet.toBuffer()],
        PROGRAM_ID
    )[0];
}

// Gets the candidate PDA for a specific poll and wallet
// This is the account that stores candidate data and vote count
export function getCandidatePda(pollId, wallet) {
    const pollBuffer = new anchor.BN(pollId).toArrayLike(Buffer, "le", 8);
    
    return PublicKey.findProgramAddressSync(
        [Buffer.from("candidate"), pollBuffer, wallet.toBuffer()],
        PROGRAM_ID
    )[0];
}

// Gets the candidate marker PDA for the specific poll and wallet
// This marker helps check whether a wallet is already a candidate
export function getCandidateMarkerPda(pollId, wallet) {
    const pollBuffer = new anchor.BN(pollId).toArrayLike(Buffer, "le", 8);

    return PublicKey.findProgramAddressSync(
        [Buffer.from("candidate_marker"), pollBuffer, wallet.toBuffer()],
        PROGRAM_ID
    )[0];
}
//3c This derives the on-chain address where the commitment record will be stored.
// Gets the commitment record PDA for a specific poll and nullifier
// This is the account that stores the hidden vote commitment
export function getCommitmentRecordPda(pollId, nullifier) {
    const pollBuffer = new anchor.BN(pollId).toArrayLike(Buffer, "le", 8);
    const nullifierBuffer = Buffer.from(nullifier);

    return PublicKey.findProgramAddressSync(
        [Buffer.from("commitment"), pollBuffer, nullifierBuffer],
        PROGRAM_ID
    )[0];
}

// Export common Solana and Anchor helpers so other frontend files can reuse them
export { anchor, PublicKey, SystemProgram };