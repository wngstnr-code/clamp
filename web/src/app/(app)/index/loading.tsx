// Shapes hold the layout while the first read comes in. No numbers are guessed.
export default function Loading() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="flex flex-col gap-3 px-2 pt-12 pb-10 md:pt-16">
        <div className="h-14 w-72 rounded-2xl bg-line" />
        <div className="h-5 w-full max-w-[640px] rounded-full bg-line" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-6 rounded-[36px] bg-surface p-9">
            <div className="h-8 w-32 rounded-xl bg-surface-2" />
            <div className="h-20 w-64 rounded-2xl bg-surface-2" />
            <div className="h-24 rounded-2xl bg-surface-2" />
            <div className="h-4 w-48 rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
