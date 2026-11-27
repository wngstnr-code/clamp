import { AppNav } from "@/components/app-nav";

// Shell of every app page: the app nav on top, content in the same 1344 px column.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 pt-6 pb-24 md:px-12">
      <AppNav />
      <main className="mx-auto max-w-[1344px]">{children}</main>
    </div>
  );
}
