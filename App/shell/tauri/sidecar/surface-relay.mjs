/**
 * Fail-closed, non-network Browser Surface relay for Rust-owned Agent Gateway.
 * The module alone does not enable IPC: activation requires a separately audited
 * supervisor-to-Gateway transport and a live Agent-authored browser surface.
 */
import { isComputerUseSurfaceAction, isComputerUseSurfaceMessage } from '@memmy/local-api-contracts';

export const SURFACE_EVENT_PREFIX = 'MEMMY_TAURI_BROWSER_SURFACE ';
export const SURFACE_ACTION_PREFIX = 'MEMMY_TAURI_BROWSER_ACTION ';
const MAX_EVENT_BYTES = 3_200_000;
const MAX_ACTION_BYTES = 4_500;
const MAX_SESSIONS = 32;

export function createNativeBrowserSurfaceRelay({ sendAction, publish }) {
  const sessions = new Map();
  return {
    update(raw) {
      if (!isComputerUseSurfaceMessage(raw) || raw.surface !== 'browser') return false;
      const encoded = JSON.stringify(raw);
      if (Buffer.byteLength(encoded) > MAX_EVENT_BYTES) return false;
      const previous = sessions.get(raw.sessionKey);
      // A sessionKey can never be reused to hijack another task or target.
      if (previous && ['channel','chatId','targetId'].some(k => previous[k] !== raw[k])) return false;
      if (raw.type.endsWith(':close')) {
        if (!raw.presentationOnly) sessions.delete(raw.sessionKey);
      } else {
        if (!sessions.has(raw.sessionKey) && sessions.size >= MAX_SESSIONS) return false;
        sessions.set(raw.sessionKey, raw);
      }
      publish(SURFACE_EVENT_PREFIX + encoded);
      return true;
    },
    action(line) {
      if (typeof line !== 'string' || !line.startsWith(SURFACE_ACTION_PREFIX)
        || Buffer.byteLength(line) > MAX_ACTION_BYTES) return false;
      let input;
      try { input = JSON.parse(line.slice(SURFACE_ACTION_PREFIX.length)); }
      catch { return false; }
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || typeof input.sessionKey !== 'string'
        || Object.keys(input).some(key => !['sessionKey','action','x','y','deltaY','key','url'].includes(key))) return false;
      const source = sessions.get(input.sessionKey);
      if (!source) return false;
      const command = {
        type: 'memmy:computer-use-surface:action',
        surface: 'browser',
        sessionKey: source.sessionKey,
        channel: source.channel,
        chatId: source.chatId,
        targetId: source.targetId,
        action: input.action,
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.deltaY !== undefined ? { deltaY: input.deltaY } : {}),
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
      };
      if (!isComputerUseSurfaceAction(command)) return false;
      if (command.action === 'navigate') {
        try {
          const address = new URL(command.url);
          if (!['http:', 'https:'].includes(address.protocol)
            || address.username || address.password) return false;
        } catch { return false; }
      }
      return sendAction(command) === true;
    },
    clear() { sessions.clear(); },
    activeCount() { return sessions.size; },
  };
}
