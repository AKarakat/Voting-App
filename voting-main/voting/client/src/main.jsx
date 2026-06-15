// Copy 
import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import { BrowserRouter } from "react-router-dom";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";

import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";

import App from "./App.jsx";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";

window.Buffer = Buffer;

const endpoint = "http://127.0.0.1:8899";
// const endpoint = "https://api.devnet.solana.com";
const wallets = [new PhantomWalletAdapter()];

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);