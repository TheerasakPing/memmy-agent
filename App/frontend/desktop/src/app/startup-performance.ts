/** Low-overhead, in-memory startup timing marks; never includes profile content or credentials. */
export const STARTUP_PERF_MARKS = Object.freeze({
  entry: 'memmy:renderer-module-loaded',
  firstFrame: 'memmy:renderer-first-dom-frame',
  routeReady: 'memmy:route-ready-first-frame'
});

export function markRendererModuleLoaded() {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(STARTUP_PERF_MARKS.entry);
  }
}

/** First DOM frame is only a proxy for FCP, not the browser's paint metric. */
export function observeFirstDomFrame(root: Element): () => void {
  if (typeof MutationObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return () => undefined;
  let closed = false;
  let observer: MutationObserver;
  const onMutation = () => {
    if (closed || !root.hasChildNodes()) return;
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!closed && typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(STARTUP_PERF_MARKS.firstFrame);
      }
    }));
  };
  observer = new MutationObserver(onMutation);
  observer.observe(root, { childList: true, subtree: true });
  onMutation();
  return () => { closed = true; observer.disconnect(); };
}

let routeRecorded = false;
/** First ready-route animation frame is a TTI *proxy*, not a measured interaction delay. */
export function markFirstReadyRoute(): void {
  if (routeRecorded || typeof requestAnimationFrame === 'undefined') return;
  routeRecorded = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(STARTUP_PERF_MARKS.routeReady);
    }
  }));
}
