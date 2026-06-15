export const ALLOWED_WALLETS = [
  // Add allowed voter wallet addresses here
  "FZLHx5wv9AZg3UhehWQ4P1kMbeJvZejMinPmWwQ3NwUS", "BFpPmUEYNwRVRkarCPUwnJXSqfgVAbzTHvqQY2cAqHBA", 
  "DWDVPYEA5BtkwUoAFoiup88MZsDYKWVzJLFDEQTJCDRY", "9BCtGF6kiiXhDMv32rcWL9zPKeASenDcuna9g41zWpiz",
  "5Kfg7jnobgQbczR3BsRqZXTc7KnYt4PGJkVs29kRyHZx",
];

export function isAllowedWallet(walletAddress) {
  return ALLOWED_WALLETS.includes(walletAddress);
}