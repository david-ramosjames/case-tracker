import { type RefObject, type UIEvent } from "react";

/**
 * Keep two overflow containers in lockstep without feedback jitter.
 * A one-frame lock stops A→B from immediately writing B→A.
 */
export function createSyncedHorizontalScroll() {
  let syncing = false;

  return function syncScroll(
    event: UIEvent<HTMLDivElement>,
    targetRef: RefObject<HTMLDivElement | null>,
  ) {
    if (syncing) return;
    const target = targetRef.current;
    if (!target) return;
    const next = event.currentTarget.scrollLeft;
    if (Math.abs(target.scrollLeft - next) < 0.5) return;
    syncing = true;
    target.scrollLeft = next;
    requestAnimationFrame(() => {
      syncing = false;
    });
  };
}
