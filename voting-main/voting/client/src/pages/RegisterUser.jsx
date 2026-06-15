import { useState } from "react";
import { isAllowedWallet } from "../utils/allowedWallets";

export default function RegisterUser() {
    const [walletAddress, setWalletAddress] = useState("");
    const [message, setMesage] = useState("");

    function checkWallet() {
        if (isAllowedWallet(walletAddress.trim())) {
            setMessage("Wallet is allowed. you can now connect your wallet.");
        } else {
            setMessage("wallet is not allowed.");
        }
    }

    return (
        <div className="card">
            <h1>Register User</h1>
            <p>Enter your wallet address to check if you are allowed.</p>

            <input
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="Enter wallet address"
            />

            <button onClick={checkWallet}>Check Wallet</button>

            {message && <p className="message">{message}</p>}
        </div>
    );
}

