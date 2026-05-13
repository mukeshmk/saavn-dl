export default function TrackSkeleton() {
  return (
    <div className="w-full rounded-2xl border border-border bg-glass p-5 animate-pulse">
      <div className="flex gap-5">
        {/* Album art skeleton */}
        <div className="w-32 h-32 rounded-xl bg-border flex-shrink-0 shimmer-block" />

        {/* Meta skeleton */}
        <div className="flex-1 space-y-3 py-1">
          <div className="h-6 bg-border rounded-lg w-3/4 shimmer-block" />
          <div className="h-4 bg-border rounded-lg w-1/2 shimmer-block" />
          <div className="h-4 bg-border rounded-lg w-2/5 shimmer-block" />
          <div className="flex gap-2 pt-2">
            <div className="h-8 bg-border rounded-lg w-24 shimmer-block" />
            <div className="h-8 bg-border rounded-lg w-24 shimmer-block" />
          </div>
        </div>
      </div>
      <div className="mt-4 h-px bg-border" />
      <div className="mt-4 flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-7 w-16 bg-border rounded-lg shimmer-block" />
        ))}
      </div>
      <div className="mt-3 h-12 bg-border rounded-xl shimmer-block" />
    </div>
  );
}
