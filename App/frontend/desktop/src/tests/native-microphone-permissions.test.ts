import { describe, expect, it, vi } from "vitest";
import {
  getNativeMicrophoneAccessStatus, requestNativeMicrophoneAccess
} from "../native-microphone-permissions.js";

function fakeNavigator(
  capture?: (options: MediaStreamConstraints) => Promise<MediaStream>,
  query?: (descriptor: PermissionDescriptor) => Promise<PermissionStatus>
): Navigator {
  return {
    mediaDevices: capture ? { getUserMedia: capture } : undefined,
    permissions: query ? { query } : undefined
  } as unknown as Navigator;
}

describe("Tauri WebKit microphone permissions (real consent, no fake grants)", () => {
  it("does not claim mic access when capture API is unavailable", async () => {
    expect(await getNativeMicrophoneAccessStatus(fakeNavigator())).toBe("unsupported");
    expect(await requestNativeMicrophoneAccess(fakeNavigator())).toBe("unsupported");
  });
  it.each([
    ["granted", "granted"], ["denied", "denied"], ["prompt", "not-determined"]
  ] as const)("queries permission without opening a stream: %s", async (state, result) => {
    const capture = vi.fn();
    const query = vi.fn(async () => ({ state } as PermissionStatus));
    expect(await getNativeMicrophoneAccessStatus(fakeNavigator(capture, query))).toBe(result);
    expect(query).toHaveBeenCalledWith({ name: "microphone" });
    expect(capture).not.toHaveBeenCalled();
  });
  it("does not falsely report denial when WebKit permission query is unsupported", async () => {
    const navigator = fakeNavigator(vi.fn(), vi.fn(async () => {
      throw new TypeError("microphone permission query unsupported");
    }));
    expect(await getNativeMicrophoneAccessStatus(navigator)).toBe("not-determined");
    expect(await getNativeMicrophoneAccessStatus(fakeNavigator(vi.fn()))).toBe("not-determined");
  });
  it("returns granted only after OS/browser capture succeeds and stops all tracks", async () => {
    const first = { stop: vi.fn() }, second = { stop: vi.fn() };
    const capture = vi.fn(async () =>
      ({ getTracks: () => [first, second] }) as unknown as MediaStream
    );
    expect(await requestNativeMicrophoneAccess(fakeNavigator(capture))).toBe("granted");
    expect(capture).toHaveBeenCalledWith({ audio: true, video: false });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
  it.each([
    ["NotAllowedError", "denied"],
    ["PermissionDeniedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "unsupported"],
    ["NotReadableError", "not-determined"],
    ["AbortError", "not-determined"],
  ] as const)("maps capture failure %s to %s without elevation", async (name, result) => {
    const capture = vi.fn(async () => { throw Object.assign(new Error("failed"), { name }); });
    expect(await requestNativeMicrophoneAccess(fakeNavigator(capture))).toBe(result);
  });
});
