import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createNativeBrowserSurfaceRelay, SURFACE_ACTION_PREFIX, SURFACE_EVENT_PREFIX,
} from './surface-relay.mjs';

const snapshot = (sessionKey = 'chat-A') => ({
  type: 'memmy:computer-use-surface:update',
  surface: 'browser',
  sessionKey,
  channel: 'websocket',
  chatId: 'chat-001',
  targetId: 'active-tab',
  title: 'Browser',
  url: 'https://example.com/',
  imageDataUrl: 'data:image/png;base64,aGVsbG8=',
});
const action = (sessionKey, command) =>
  SURFACE_ACTION_PREFIX + JSON.stringify({ sessionKey, ...command });
const setup = () => {
  const published = [], actions = [];
  const relay = createNativeBrowserSurfaceRelay({
    publish: line => published.push(line),
    sendAction: value => { actions.push(value); return true; },
  });
  return { relay, published, actions };
};

test('only real Agent-authored browser surfaces appear in native snapshots', () => {
  const { relay, published } = setup();
  assert.equal(relay.update({ ...snapshot(), surface: 'computer' }), false);
  assert.equal(relay.update({ ...snapshot(), imageDataUrl: 'file:///private/key' }), false);
  assert.equal(relay.update({ ...snapshot(), identity: 'untrusted' }), false);
  assert.equal(relay.update(snapshot()), true);
  assert.equal(relay.activeCount(), 1);
  assert.equal(published.length, 1);
  assert.equal(published[0], SURFACE_EVENT_PREFIX + JSON.stringify(snapshot()));
});

test('actions inherit exact session identity; forged sessions and privileges fail closed', () => {
  const { relay, actions } = setup();
  assert.equal(relay.action(action('chat-A', { action: 'open' })), false);
  assert.equal(relay.update(snapshot()), true);
  for (const malformed of [
    action('chat-B', { action: 'open' }),
    action('chat-A', { action: 'click', x: 2, y: 0.5 }),
    action('chat-A', { action: 'navigate', url: 'javascript:alert(1)' }),
    action('chat-A', { action: 'navigate', url: 'https://user:pass@example.com/' }),
    action('chat-A', { action: 'open', command: 'shell' }),
    action('chat-A', { action: 'eval', key: 'something' }),
    'MEMMY_TAURI_BROWSER_ACTION {this is not json',
  ]) assert.equal(relay.action(malformed), false, malformed);
  assert.equal(relay.action(action('chat-A', { action: 'click', x: 0.2, y: 0.7 })), true);
  assert.deepEqual(actions, [{
    type: 'memmy:computer-use-surface:action',
    surface: 'browser', sessionKey: 'chat-A', channel: 'websocket',
    chatId: 'chat-001', targetId: 'active-tab', action: 'click', x: 0.2, y: 0.7,
  }]);
});

test('closing a surface or shutting down the managed Gateway revokes all actions', () => {
  const { relay, actions } = setup();
  assert.equal(relay.update(snapshot()), true);
  assert.equal(relay.update({
    type: 'memmy:computer-use-surface:close',
    surface: 'browser', sessionKey: 'chat-A', channel: 'websocket',
    chatId: 'chat-001', targetId: 'active-tab', title: 'Browser',
  }), true);
  assert.equal(relay.action(action('chat-A', { action: 'reload' })), false);
  assert.equal(relay.update(snapshot()), true);
  relay.clear();
  assert.equal(relay.activeCount(), 0);
  assert.equal(relay.action(action('chat-A', { action: 'open' })), false);
  assert.deepEqual(actions, []);
});

test('oversize and unrelated child IPC are never forwarded', () => {
  const { relay, published } = setup();
  assert.equal(relay.update({ ...snapshot(), imageDataUrl: 'data:image/png;base64,' + 'A'.repeat(3_200_000) }), false);
  assert.equal(relay.update({ type: 'memmy:browser-capability:request', requestId: 'x' }), false);
  assert.equal(relay.action(SURFACE_ACTION_PREFIX + 'x'.repeat(4600)), false);
  assert.equal(relay.activeCount(), 0);
  assert.deepEqual(published, []);
});

test('Agent session identity cannot be silently rebound to a different chat or tab', () => {
  const {relay,actions} = setup();
  assert.equal(relay.update(snapshot()),true);
  assert.equal(relay.update({...snapshot(), chatId:'different-chat'}),false);
  assert.equal(relay.update({...snapshot(), targetId:'another-tab'}),false);
  assert.equal(relay.update({...snapshot(), type:'memmy:computer-use-surface:close',channel:'other-channel'}),false);
  assert.equal(relay.activeCount(),1);
  assert.equal(relay.action(action('chat-A',{action:'reload'})),true);
  assert.equal(actions[0].chatId,'chat-001');
  relay.clear();
});
