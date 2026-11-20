"use client";

import dynamic from "next/dynamic";

// The wallet button reads browser wallets, so it renders on the client only.
export const WalletButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);
