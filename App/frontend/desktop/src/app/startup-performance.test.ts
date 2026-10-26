import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_PERF_MARKS, markFirstReadyRoute, markRendererModuleLoaded } from './startup-performance.js';

afterEach(() => vi.unstubAllGlobals());

describe('in-memory startup markers', () => {
  it('marks renderer module without serializing user data', () => {
    const mark = vi.fn();
    vi.stubGlobal('performance', { mark });
    markRendererModuleLoaded();
    expect(mark).toHaveBeenCalledExactlyOnceWith(STARTUP_PERF_MARKS.entry);
  });
  it('records first ready-route frame once', () => {
    const mark = vi.fn();
    vi.stubGlobal('performance', { mark });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1; });
    markFirstReadyRoute();
    markFirstReadyRoute();
    expect(mark).toHaveBeenCalledExactlyOnceWith(STARTUP_PERF_MARKS.routeReady);
  });
});
