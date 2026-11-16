import { type RefObject, type UIEvent } from "react";

/**
 * Keep two overflow containers in lockstep.
 * Uses scroll *ratio* (not raw scrollLeft) so a vertical scrollbar on one pane
 * does not desync max scroll and fight the thumb. The active driver owns sync
 * for a short window so reverse onScroll events cannot yank the thumb mid-drag.
 */
export function createSyncedHorizontalScroll() {
  let driver: HTMLElement | null = null;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;

  function clearUnlock() {
    if (unlockTimer != null) {
      clearTimeout(unlockTimer);
      unlockTimer = null;
    }
  }

  function claimDriver(source: HTMLElement) {
    driver = source;
    clearUnlock();
    unlockTimer = setTimeout(() => {
      driver = null;
      unlockTimer = null;
    }, 120);
  }

  function syncRatio(source: HTMLElement, target: HTMLElement) {
    const sourceMax = source.scrollWidth - source.clientWidth;
    const targetMax = target.scrollWidth - target.clientWidth;
    if (sourceMax <= 0 || targetMax <= 0) {
      if (target.scrollLeft !== 0) target.scrollLeft = 0;
      return;
    }
    const next = (source.scrollLeft / sourceMax) * targetMax;
    if (Math.abs(target.scrollLeft - next) > 0.5) {
      target.scrollLeft = next;
    }
  }

  return function syncScroll(
    event: UIEvent<HTMLDivElement>,
    targetRef: RefObject<HTMLDivElement | null>,
  ) {
    const source = event.currentTarget;
    if (driver && driver !== source) return;
    const target = targetRef.current;
    if (!target) return;
    claimDriver(source);
    syncRatio(source, target);
  };
}
