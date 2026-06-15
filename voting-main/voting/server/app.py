# Import Flask so we can create a small web backend
from flask import Flask, request, jsonify

# Import CORS so the frontend can call this backend from another address
from flask_cors import CORS

# Import RSA so this backend can create an RSA signing key
from Crypto.PublicKey import RSA

# Import hashlib so we can create SHA256 hashes
import hashlib

# Import os so we can read environment variables and create random bytes
import os

# Import json so we can read the Solana keypair file
import json

# Import struct so we can pack numbers into bytes for Solana instruction data
import struct


# Use this to activate the Python virtual environment
# .\venv\Scripts\Activate.ps1

# Use this to run the backend
# python app.py

# Then test the public key route
# /public-key

# Check for the Solana keypair file here
# $env:USERPROFILE\.config\solana\id.json

# If the key is not present, generate a new one with this command
# solana-keygen new --outfile $env:USERPROFILE\.config\solana\id.json


# Import the Solana RPC client so this backend can talk to the Solana network
from solana.rpc.api import Client

# Import Keypair so the backend can load the relayer wallet
from solders.keypair import Keypair

# Import Pubkey so the backend can work with Solana public keys
from solders.pubkey import Pubkey

# Import Instruction and AccountMeta so we can manually build Solana instructions
from solders.instruction import Instruction, AccountMeta

# Import Message so we can build the transaction message
from solders.message import Message

# Import Transaction so we can create and sign a Solana transaction
from solders.transaction import Transaction

# Import the Solana system program id
from solders.system_program import ID as SYSTEM_PROGRAM_ID


# Create the Flask app
app = Flask(__name__)

# Allow requests from the frontend
CORS(app)


# ---------------------------
# Overview
# ---------------------------

# This backend is used for the private voting flow
#
# It does these main things:
#
# 1. Gives the frontend an RSA public key
#
# 2. Blind-signs a token for a wallet once per poll
#
# 3. Verifies the unblinded credential later
#
# 4. Creates a nullifier from the token and poll id
#
# 5. Creates a hidden vote commitment from poll id, candidate id, and nonce
#
# 6. Stores the nonce and candidate choice off-chain for the reveal phase
#
# 7. Sends the reveal_vote transaction to the Solana program using the relayer wallet


# ---------------------------
# Solana config
# ---------------------------

# Use the local validator
SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "http://127.0.0.1:8899")

# Read the Anchor program id from the environment
# If it is not set, use the default program id
PROGRAM_ID = Pubkey.from_string(
    os.getenv("PROGRAM_ID", "2uQA8d8LujCRnCBhTVaDRipa2NshWRmyJAD6sr96knjY")
)

# Read the relayer keypair path from the environment
# If it is not set, use the default Solana keypair location
RELAYER_KEYPAIR_PATH = os.getenv(
    "RELAYER_KEYPAIR_PATH",
    os.path.expanduser("~/.config/solana/id.json")
)

# Create a Solana RPC client
# This lets the backend send transactions and fetch blockhashes
client = Client(SOLANA_RPC_URL)


# Loads a Solana keypair from a JSON file
def load_keypair(path):
    # Open the keypair file
    with open(path, "r") as f:
        # Read the secret key bytes from JSON
        secret = json.load(f)

    # Turn the secret key bytes into a Keypair object
    return Keypair.from_bytes(bytes(secret))


# Load the relayer wallet
# This wallet signs and pays for reveal transactions
relayer = load_keypair(RELAYER_KEYPAIR_PATH)


# ---------------------------
# RSA auth key
# ---------------------------

# Generate a new RSA key when the backend starts
# This key is used to blind-sign voting credentials
authority_key = RSA.generate(2048)

# Store the RSA modulus
# This is part of the public key
N = authority_key.n

# Store the RSA public exponent
# This is part of the public key
e = authority_key.e

# Store the RSA private exponent
# This is used by the backend to sign blinded tokens
d = authority_key.d


# ---------------------------
# In-memory storage
# ---------------------------

# Stores which wallet has already requested a credential for each poll
# This helps stop the same wallet requesting multiple credentials for the same poll
issued_credentials = set()

# Stores reveal data until the reveal phase
# The key is usually poll id plus nullifier
stored_reveals = {}


# ---------------------------
# Helper functions
# ---------------------------

# Creates a nullifier from a token and poll id
# The nullifier is later used to stop the same credential being used twice
def compute_nullifier(token_hex, poll_id):
    # Convert the token from hex text into bytes
    token_bytes = bytes.fromhex(token_hex)

    # Create a new SHA256 hasher
    hasher = hashlib.sha256()

    # Add a fixed label so this hash is clearly for vote nullifiers
    hasher.update(b"vote-nullifier")

    # Add the poll id to make the nullifier unique per poll
    hasher.update(str(poll_id).encode())

    # Add the token bytes
    hasher.update(token_bytes)

    # Return the final 32-byte hash
    return hasher.digest()

#2c 
# Creates a vote commitment
# This creates the hidden vote. It hashes the poll ID, candidate ID, and nonce
# This hides the selected candidate until the reveal phase
def compute_commitment(poll_id, candidate_id, nonce):
    # Create a new SHA256 hasher
    hasher = hashlib.sha256()

    # Add a fixed label so this hash is clearly for vote commitments
    hasher.update(b"vote-commitment")

    # Add the poll id as 8 little-endian bytes
    # This must match the Anchor program's hashing logic
    hasher.update(int(poll_id).to_bytes(8, "little"))

    # Add the candidate id as 8 little-endian bytes
    # This must also match the Anchor program's hashing logic
    hasher.update(int(candidate_id).to_bytes(8, "little"))

    # Add the random nonce
    # The nonce hides the candidate choice inside the commitment
    hasher.update(nonce)

    # Return the final 32-byte commitment hash
    return hasher.digest()


# Verifies that the RSA signature matches the token
def verify_signature(token_hex, signature_hex):
    # Convert the token from hex text into a number
    token = int(token_hex, 16)

    # Convert the signature from hex text into a number
    signature = int(signature_hex, 16)

    # RSA verification calculates signature^e mod N
    verified = pow(signature, e, N)

    # The signature is valid if the result equals the original token
    return verified == token


# Creates the Anchor instruction discriminator
# Anchor instructions start with the first 8 bytes of sha256("global:instruction_name")
def anchor_discriminator(name):
    # Hash the Anchor instruction name and return the first 8 bytes
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


# Finds a PDA for this program using the given seeds
def pda(seeds):
    # Return only the PDA address
    # The bump is ignored here because this backend only needs the address
    return Pubkey.find_program_address(seeds, PROGRAM_ID)[0]


# Gets the election state PDA
# This must match seeds = [b"election_state"] in contexts.rs
def get_election_state_pda():
    # Return the PDA for the main election state account
    return pda([b"election_state"])


# Gets the candidate PDA for a poll and candidate wallet
# This must match the candidate seeds in contexts.rs
def get_candidate_pda(poll_id, candidate_wallet):
    # Build and return the candidate PDA
    return pda([
        # Fixed seed showing this is a candidate account
        b"candidate",

        # Poll id as 8 little-endian bytes
        int(poll_id).to_bytes(8, "little"),

        # Candidate wallet public key bytes
        Pubkey.from_string(candidate_wallet).__bytes__(),
    ])


# Gets the commitment record PDA for a poll and nullifier
# This must match the commitment seeds in contexts.rs
def get_commitment_record_pda(poll_id, nullifier_bytes):
    # Build and return the commitment record PDA
    return pda([
        # Fixed seed showing this is a commitment account
        b"commitment",

        # Poll id as 8 little-endian bytes
        int(poll_id).to_bytes(8, "little"),

        # Nullifier bytes
        nullifier_bytes,
    ])


# Sends a reveal_vote transaction to the Solana program
# This is the backend calling the Anchor reveal_vote instruction
def send_reveal_transaction(poll_id, candidate_id, candidate_wallet, nullifier_hex, nonce_hex):
    # Convert the nullifier from hex text into bytes
    nullifier = bytes.fromhex(nullifier_hex)

    # Convert the nonce from hex text into bytes
    nonce = bytes.fromhex(nonce_hex)

    # Get the main election state PDA
    election_state = get_election_state_pda()

    # Get the candidate account PDA
    candidate_account = get_candidate_pda(poll_id, candidate_wallet)

    # Get the commitment record PDA
    commitment_record = get_commitment_record_pda(poll_id, nullifier)

    # Anchor instruction data:
    # discriminator + candidate_id:u64 + nullifier:[u8; 32] + nonce:[u8; 32]
    data = (
        # First 8 bytes tell Anchor which instruction to run
        anchor_discriminator("reveal_vote")

        # candidate_id is encoded as a little-endian u64
        + struct.pack("<Q", int(candidate_id))

        # nullifier is passed as 32 bytes
        + nullifier

        # nonce is passed as 32 bytes
        + nonce
    )

    # Accounts must be in the same order as the RevealVote context in contexts.rs
    accounts = [
        # The relayer signs and pays for the transaction
        # True means signer
        # True means writable
        AccountMeta(relayer.pubkey(), True, True),

        # The election state account
        # False means it does not sign
        # True means writable
        AccountMeta(election_state, False, True),

        # The candidate account that receives the vote
        # False means it does not sign
        # True means writable because vote_count changes
        AccountMeta(candidate_account, False, True),

        # The commitment record account
        # False means it does not sign
        # True means writable because it is marked as revealed
        AccountMeta(commitment_record, False, True),

        # The system program
        # False means it does not sign
        # False means read-only
        AccountMeta(SYSTEM_PROGRAM_ID, False, False),
    ]

    # Build the Solana instruction
    ix = Instruction(PROGRAM_ID, data, accounts)

    # Get a recent blockhash needed for the transaction
    latest_blockhash = client.get_latest_blockhash().value.blockhash

    # Build the transaction message with the relayer as payer
    msg = Message.new_with_blockhash([ix], relayer.pubkey(), latest_blockhash)

    # Create and sign the transaction using the relayer keypair
    tx = Transaction([relayer], msg, latest_blockhash)

    # Send the transaction to Solana
    result = client.send_transaction(tx)

    # Return the transaction signature as text
    return str(result.value)


# ----------------------------
# Routes
# ----------------------------

# Basic health check route
# This lets you quickly check that the backend is running
@app.route("/", methods=["GET"])
def home():
    # Return a simple text response
    return "Python RSA blind-signature backend is running"


# Public key route
# The frontend uses this to get the RSA public key
@app.route("/public-key", methods=["GET"])
def public_key():
    # Return the RSA public key parts as hex strings
    return jsonify({
        # RSA modulus
        "n": hex(N)[2:],

        # RSA public exponent
        "e": hex(e)[2:]
    })


# Credential request route
# The frontend sends a blinded token here
# The backend signs it without seeing the real token
@app.route("/request-credential", methods=["POST"])
def request_credential():
    # Read the JSON body from the request
    data = request.get_json()

    # Get the wallet address from the request body
    wallet_address = data.get("walletAddress")

    # Get the poll id from the request body
    poll_id = data.get("pollId")

    # Get the blinded token from the request body
    blinded_token_hex = data.get("blindedToken")

    # Make sure all required fields were provided
    if not wallet_address or not poll_id or not blinded_token_hex:
        return jsonify({"error": "Missing walletAddress, pollId, or blindedToken"}), 400
    
    #5b
    credential_key = (wallet_address, str(poll_id))
    # Stop the same wallet from requesting more than one credential for the same poll
    #If credentials has not been asked for before if not signs it 
    if credential_key in issued_credentials:
        return jsonify({
            "error": "This wallet had already requested a credential for this poll"
        }), 403

    # Convert the blinded token from hex text into a number
    blinded_token = int(blinded_token_hex, 16)

    # RSA-sign the blinded token using the private exponent
    signed_blinded = pow(blinded_token, d, N)

    # Mark this wallet as having received a credential for this poll
    issued_credentials.add(credential_key)

    # Return the signed blinded token to the frontend
    return jsonify({
        "signedBlindedToken": hex(signed_blinded)[2:]
    })


# Credential verification route
# This checks an unblinded token and signature
@app.route("/verify-credential", methods=["POST"])
def verify_credential():
    # Read the JSON body from the request
    data = request.get_json()

    # Get the real token from the request body
    token_hex = data.get("token")

    # Get the unblinded RSA signature from the request body
    signature_hex = data.get("signature")

    # Get the poll id from the request body
    poll_id = data.get("pollId")

    # Make sure all required fields were provided
    if not token_hex or not signature_hex or not poll_id:
        return jsonify({"error": "Missing token, signature, or pollId"}), 400

    # Check that the RSA signature is valid for this token
    if not verify_signature(token_hex, signature_hex):
        return jsonify({"error": "Invalid blind signature"}), 400

    # Create a nullifier from the token and poll id
    # This nullifier can be used to stop duplicate voting
    nullifier = compute_nullifier(token_hex, poll_id)

    # Return the nullifier to the frontend
    return jsonify({
        "valid": True,
        "nullifier": nullifier.hex()
    })


# Prepare commit route
# This prepares the hidden vote commitment before the frontend commits on-chain
@app.route("/prepare-commit", methods=["POST"])
def prepare_commit():
    # Read the JSON body from the request
    data = request.get_json()

    # Get the real token from the request body
    token_hex = data.get("token")

    # Get the unblinded RSA signature from the request body
    signature_hex = data.get("signature")

    # Get the poll id from the request body
    poll_id = data.get("pollId")

    # Get the selected candidate id from the request body
    candidate_id = data.get("candidateId")

    # Get the selected candidate wallet from the request body
    candidate_wallet = data.get("candidateWallet")

    # Make sure all required fields were provided
    if not token_hex or not signature_hex or not poll_id or not candidate_id or not candidate_wallet:
        return jsonify({
            "error": "Missing token, signature, pollId, candidateId, or candidateWallet"
        }), 400

    # Check that the RSA signature is valid
    if not verify_signature(token_hex, signature_hex):
        return jsonify({"error": "Invalid blind signature"}), 400

    # Create a nullifier from the token and poll id
    nullifier = compute_nullifier(token_hex, poll_id)

    # Create a random 32-byte nonce
    # This hides the candidate choice inside the commitment
    nonce = os.urandom(32)

    # Create the hidden vote commitment
    commitment = compute_commitment(poll_id, candidate_id, nonce)

    # Create a lookup key so this reveal data can be found later
    reveal_key = (str(poll_id), nullifier.hex())

    # Store the reveal data off-chain
    # This is needed later to reveal the committed vote
    stored_reveals[reveal_key] = {
        # Save the selected candidate id
        "candidate_id": int(candidate_id),

        # Save the selected candidate wallet
        "candidate_wallet": candidate_wallet,

        # Save the nonce needed to reveal the commitment
        "nonce": nonce,

        # Track whether this vote has already been revealed
        "revealed": False
    }

    # Return the commitment data to the frontend
    # The frontend can then send commit_vote on-chain
    return jsonify({
        "valid": True,
        "pollId": str(poll_id),
        "candidateId": int(candidate_id),
        "candidateWallet": candidate_wallet,
        "nullifier": nullifier.hex(),
        "commitment": commitment.hex()
    })


# Prepare reveal route
# This returns the stored reveal data without sending a transaction
@app.route("/prepare-reveal", methods=["POST"])
def prepare_reveal():
    # Read the JSON body from the request
    data = request.get_json()

    # Get the poll id from the request body
    poll_id = data.get("pollId")

    # Get the nullifier from the request body
    nullifier_hex = data.get("nullifier")

    # Make sure all required fields were provided
    if not poll_id or not nullifier_hex:
        return jsonify({"error": "Missing PollId or nullifier"}), 400

    # Create the key used to find the stored reveal data
    reveal_key = (str(poll_id), nullifier_hex)

    # Make sure reveal data exists for this poll and nullifier
    if reveal_key not in stored_reveals:
        return jsonify({"error": "No stored reveal data for this vote"}), 400

    # Get the stored reveal data
    reveal_data = stored_reveals[reveal_key]

    # Return the data needed to reveal the vote
    return jsonify({
        "pollId": str(poll_id),
        "candidateId": reveal_data["candidate_id"],
        "candidateWallet": reveal_data["candidate_wallet"],
        "nullifier": nullifier_hex,
        "nonce": reveal_data["nonce"].hex()
    })


# Reveal one vote route
# This sends one reveal_vote transaction to the Solana program
@app.route("/reveal-one", methods=["POST"])
def reveal_one():
    # Read the JSON body from the request
    data = request.get_json()

    # Get the poll id from the request body
    poll_id = data.get("pollId")

    # Get the nullifier from the request body
    nullifier_hex = data.get("nullifier")

    # Make sure all required fields were provided
    if not poll_id or not nullifier_hex:
        return jsonify({"error": "Missing pollId or nullifier"}), 400

    # Create the key used to find the stored reveal data
    reveal_key = (str(poll_id), nullifier_hex)

    # Make sure reveal data exists for this vote
    if reveal_key not in stored_reveals:
        return jsonify({"error": "No stored reveal datafor this vote"}), 404

    # Get the stored reveal data
    reveal_data = stored_reveals[reveal_key]

    # Stop the same stored vote from being revealed twice by this backend
    if reveal_data["revealed"]:
        return jsonify({"error": "vote already revealed"}), 400

    # Send the reveal_vote transaction to the Solana program
    tx = send_reveal_transaction(
        poll_id=poll_id,
        candidate_id=reveal_data["candidate_id"],
        candidate_wallet=reveal_data["candidate_wallet"],
        nullifier_hex=nullifier_hex,
        nonce_hex=reveal_data["nonce"].hex()
    )

    # Mark this vote as revealed in backend storage
    reveal_data["revealed"] = True

    # Return the transaction signature
    return jsonify({
        "revealed": True,
        "tx": tx
    })


# Reveal all votes route
# This reveals every stored unrevealed vote for a poll
@app.route("/reveal-all", methods=["POST"])
def reveal_all():
    # Read the JSON body from the request
    data = request.get_json()

    # Get the poll id from the request body
    poll_id = data.get("pollId")

    # Make sure the poll id was provided
    if not poll_id:
        return jsonify({"error": "Missing pollId"}), 400

    # Store the result for each attempted reveal
    results = []

    # Loop through every stored reveal entry
    # list(...) is used so the dictionary can safely be read while updating values
    for (stored_poll_id, nullifier_hex), reveal_data in list(stored_reveals.items()):

        # Skip votes from other polls
        if stored_poll_id != str(poll_id):
            continue

        # Skip votes that this backend has already revealed
        if reveal_data["revealed"]:
            continue

        try:
            # Send the reveal_vote transaction to the Solana program
            tx = send_reveal_transaction(
                poll_id=poll_id,
                candidate_id=reveal_data["candidate_id"],
                candidate_wallet=reveal_data["candidate_wallet"],
                nullifier_hex=nullifier_hex,
                nonce_hex=reveal_data["nonce"].hex()
            )

            # Mark this vote as revealed in backend storage
            reveal_data["revealed"] = True

            # Save the successful result
            results.append({
                "nullifier": nullifier_hex,
                "revealed": True,
                "tx": tx
            })

        except Exception as exc:
            # Save the failed result instead of stopping the whole loop
            results.append({
                "nullifier": nullifier_hex,
                "revealed": False,
                "error": str(exc)
            })

    # Return all reveal results for this poll
    return jsonify({
        "pollId": str(poll_id),
        "results": results
    })


# Start the Flask server when this file is run directly
if __name__ == "__main__":
    # Run on port 5000 with debug mode on
    app.run(port=5000, debug=True)