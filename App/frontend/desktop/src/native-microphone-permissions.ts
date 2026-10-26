/**
 * Actual WebKit/OS permission bridge. Never invent a "granted" status: only the
 * browser permission result or a successfully opened stream proves access.
 */
export type NativeMicrophoneStatus = "not-determined" | "granted" | "denied" | "restricted" | "unsupported";

type MicrophoneNavigator = Pick<Navigator, "mediaDevices" | "permissions">;

function supportsCapture(navigator: MicrophoneNavigator): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

export async function getNativeMicrophoneAccessStatus(navigator: MicrophoneNavigator): Promise<NativeMicrophoneStatus> {
  if (!supportsCapture(navigator)) return "unsupported";
  if (typeof navigator.permissions?.query !== "function") return "not-determined";
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (result.state === "granted") return "granted";
    if (result.state === "denied") return "denied";
    return "not-determined";
  } catch {
    // WebKit may not support querying microphone without requesting it.
    return "not-determined";
  }
}

export async function requestNativeMicrophoneAccess(navigator: MicrophoneNavigator): Promise<NativeMicrophoneStatus> {
  if (!supportsCapture(navigator)) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    try {
      return "granted";
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return "denied";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "unsupported";
    }
    // Hardware busy/temporary acquisition failure is not equivalent to denied consent.
    return "not-determined";
  }
}
