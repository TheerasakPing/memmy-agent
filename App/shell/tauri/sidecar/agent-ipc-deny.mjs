/** Immediate, schema-validated denial for Agent IPC actions without an authorized native UI.
 * Never acknowledge a browser permission or filesystem operation as approved.
 */
import {
  isBrowserAccessRequest, isBrowserCapabilityRequest, isBrowserDownloadRequest,
  isEmbeddedBrowserRequest, isBrowserProfileClearRequest,
  BROWSER_ACCESS_RESULT, BROWSER_CAPABILITY_RESULT, BROWSER_DOWNLOAD_RESULT,
  EMBEDDED_BROWSER_RESULT, BROWSER_PROFILE_CLEAR_RESULT,
} from '@memmy/local-api-contracts';

export function unsupportedAgentIpcResponse(message) {
  if (isBrowserAccessRequest(message)) {
    return { type: BROWSER_ACCESS_RESULT, requestId: message.requestId, decision: 'deny' };
  }
  if (isBrowserCapabilityRequest(message)) {
    return { type: BROWSER_CAPABILITY_RESULT, requestId: message.requestId, approved: false };
  }
  if (isBrowserDownloadRequest(message)) {
    return { type: BROWSER_DOWNLOAD_RESULT, requestId: message.requestId, filePath: null };
  }
  if (isEmbeddedBrowserRequest(message)) {
    return { type: EMBEDDED_BROWSER_RESULT, requestId: message.requestId, ok: false,
      error: 'Native embedded automation has not been authorized' };
  }
  if (isBrowserProfileClearRequest(message)) {
    return { type: BROWSER_PROFILE_CLEAR_RESULT, requestId: message.requestId, ok: false,
      error: 'Native browser data clearing is not yet available' };
  }
  return null;
}
