export default function ProtectedLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite" aria-busy="true">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-pink-200 border-t-pink-500" />
      <p className="text-sm font-semibold text-navy-950">Loading page…</p>
    </div>
  );
}
