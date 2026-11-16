// Loading placeholders shaped like what's coming, so the page doesn't jump when it arrives.
// `label` is what a screen reader hears ("Loading rankings…"); the shapes are hidden from it.
export default function Skeleton({ label, variant = "rows", count = 3, height = "h-40", className = "" }: {
  label: string; variant?: "rows" | "cards" | "block" | "lines"; count?: number; height?: string; className?: string;
}) {
  const bar = "rounded-control bg-white/[0.06] animate-shimmer";
  const items = Array.from({ length: count }, (_, index) => index);
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {variant === "block" ? <div className={`${height} w-full rounded-panel bg-white/[0.06] animate-shimmer`} />
          : variant === "lines" ? <div className="grid gap-2.5">{items.map((index) => <div key={index} className={`${bar} h-3.5`} style={{ width: `${92 - (index % 3) * 17}%`, animationDelay: `${index * 90}ms` }} />)}</div>
          : variant === "cards" ? <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {items.map((index) => <div key={index} className="well flex items-center gap-4 p-4" style={{ animationDelay: `${index * 90}ms` }}>
                <div className="h-11 w-11 shrink-0 rounded-full bg-white/[0.06] animate-shimmer" />
                <div className="grid flex-1 gap-2"><div className={`${bar} h-3.5 w-3/4`} /><div className={`${bar} h-3 w-1/2`} /></div>
              </div>)}
            </div>
          : <div className="grid gap-2">{items.map((index) => <div key={index} className="well flex items-center gap-4 px-4 py-3.5">
              <div className="h-8 w-8 shrink-0 rounded-full bg-white/[0.06] animate-shimmer" style={{ animationDelay: `${index * 90}ms` }} />
              <div className="grid flex-1 gap-2"><div className={`${bar} h-3.5 w-2/5`} style={{ animationDelay: `${index * 90}ms` }} /><div className={`${bar} h-3 w-1/4`} style={{ animationDelay: `${index * 90}ms` }} /></div>
              <div className={`${bar} h-5 w-14`} style={{ animationDelay: `${index * 90}ms` }} />
            </div>)}</div>}
      </div>
    </div>
  );
}
