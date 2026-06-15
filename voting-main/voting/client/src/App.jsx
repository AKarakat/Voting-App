import { Routes, Route, Link } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

import { isAllowedWallet } from "./utils/allowedWallets";

import RegisterUser from "./pages/RegisterUser";
import RegisterVoter from "./pages/RegisterVoter";
import RegisterCandidate from "./pages/RegisterCandidate";
import VotePage from "./pages/VotePage";
import AdminPage from "./pages/AdminPage";
import PollStatus from "./pages/PollStatus";
import "./app.css";

const ADMIN_WALLET = "BFpPmUEYNwRVRkarCPUwnJXSqfgVAbzTHvqQY2cAqHBA";

export default function App() {
  const { publicKey, connected, disconnect } = useWallet();

  const walletAddress = publicKey?.toBase58();
  const isAllowed = walletAddress ? isAllowedWallet(walletAddress) : false;
  const isAdmin = connected && walletAddress === ADMIN_WALLET;

  async function handleDisconnect() {
    try {
      await disconnect();
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  }

  return (
    <div className="app">
      <header className="navbar">
        <h2>Vote App</h2>

        <nav>
          <Link to="/">Register User</Link>
          <Link to="/status">Poll Status</Link>
          <Link to="/register-voter">Register Voter</Link>
          <Link to="/register-candidate">Register Candidate</Link>
          <Link to="/vote">Vote</Link>
          {isAdmin && <Link to="/admin">Admin</Link>}
        </nav>

        <div className="wallet-area">
          <WalletMultiButton />

          {connected && (
            <button className="disconnect-button" onClick={handleDisconnect}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      {connected && (
        <div className="wallet-info">Connected wallet: {walletAddress}</div>
      )}

      {connected && !isAllowed && !isAdmin && (
        <div className="warning">
          This wallet is not in the allowed wallet list. You cannot use the app.
        </div>
      )}

      <main className="container">
        <Routes>
          <Route path="/" element={<RegisterUser />} />
          <Route path="/status" element={<PollStatus />} />

          <Route
            path="/register-voter"
            element={connected && isAllowed ? <RegisterVoter /> : <Blocked />}
          />

          <Route
            path="/register-candidate"
            element={
              connected && isAllowed ? <RegisterCandidate /> : <Blocked />
            }
          />

          <Route
            path="/vote"
            element={connected && isAllowed ? <VotePage /> : <Blocked />}
          />

          <Route
            path="/admin"
            element={isAdmin ? <AdminPage /> : <AdminBlocked />}
          />
        </Routes>
      </main>
    </div>
  );
}

function Blocked() {
  return (
    <div className="card">
      <h2>Access blocked</h2>
      <p>Please connect an allowed wallet to use this page.</p>
    </div>
  );
}

function AdminBlocked() {
  return (
    <div className="card">
      <h2>Admin access only</h2>
      <p>This page can only be viewed by the admin wallet.</p>
    </div>
  );
}