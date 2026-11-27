import { Demo } from "@/components/landing/demo";
import { Footer } from "@/components/landing/footer";
import { FourProviders } from "@/components/landing/four-providers";
import { Hero } from "@/components/landing/hero";
import { PickYourSide } from "@/components/landing/pick-your-side";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Story } from "@/components/landing/story";
import { CLASS, readIndex } from "@/lib/live-index";
import { readLatestUpdate } from "@/lib/live-sources";

// Re-read the on-chain index and the latest provider prices at most once a minute.
export const revalidate = 60;

export default async function Landing() {
  const [rtx, h100, h100Update] = await Promise.all([
    readIndex(CLASS.rtx4090),
    readIndex(CLASS.h100),
    readLatestUpdate(CLASS.h100),
  ]);
  return (
    <main>
      <SmoothScroll />
      <Hero rtx={rtx} h100={h100} />
      <PickYourSide />
      <Story />
      <FourProviders rtx={rtx} h100={h100} update={h100Update} />
      <Demo />
      <Footer />
    </main>
  );
}
