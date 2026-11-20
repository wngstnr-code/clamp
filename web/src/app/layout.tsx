import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import { WalletButton } from "@/components/wallet-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clamp",
  description: "Lock your GPU rental price on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                Clamp
                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-normal uppercase text-muted">
                  devnet
                </span>
              </Link>
              <WalletButton />
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
