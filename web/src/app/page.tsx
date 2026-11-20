import { WalletStatus } from "@/components/wallet-status";

export default function Home() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Lock your GPU rental price.</h1>
      <p className="max-w-2xl text-muted">
        Clamp is a two-way price lock for GPU rental on Solana. Renters lock their bill, GPU owners lock their
        revenue, and every claim is fully collateralized. Runs on devnet with test USDC.
      </p>
      <WalletStatus />
    </section>
  );
}
