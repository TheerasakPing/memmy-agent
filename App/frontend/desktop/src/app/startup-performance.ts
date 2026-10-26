/** Low-overhead, in-memory startup timing marks; never includes profile content or credentials. */
export const STARTUP_PERF_MARKS = Object.freeze({
  entry: 'memmy:renderer-module-loaded',
  firstFrame: 'memmy:renderer-first-dom-frame',
  routeReady: 'memmy:route-ready-first-frame'
});

function reportStartupMark(name: string): void {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return;
  const host = window as Window & { __TAURI__?: { core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } } };
  const invoke = host.__TAURI__?.core?.invoke;
  if (!invoke) return;
  const mark = performance.getEntriesByName?.(`memmy:${name}`, 'mark').at(-1);
  if (!mark) return;
  // Rust rejects non-allowlisted labels and invalid durations. Never send paths or secrets.
  void invoke('desktop_record_startup_mark', { phase: name, elapsedMs: mark.startTime }).catch(() => undefined);
}

export function markRendererModuleLoaded() {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(STARTUP_PERF_MARKS.entry);
    reportStartupMark('renderer-module-loaded');
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
        reportStartupMark('renderer-first-dom-frame');
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
      reportStartupMark('route-ready-first-frame');
    }
  }));
}
