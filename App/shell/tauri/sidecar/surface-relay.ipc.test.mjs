import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createNativeBrowserSurfaceRelay, SURFACE_ACTION_PREFIX, SURFACE_EVENT_PREFIX } from './surface-relay.mjs';

test('private Node IPC delivers Agent screenshot and session-scoped action', { timeout: 20000 }, async () => {
  const childScript = [
    "process.send({type:'memmy:computer-use-surface:update',surface:'browser',",
    "sessionKey:'agent-chat',channel:'websocket',chatId:'chat-A',targetId:'active-tab',",
    "title:'Agent Browser',url:'https://example.org',imageDataUrl:'data:image/png;base64,aGVsbG8='});",
    "process.on('message', action => { process.send({ack:action}); process.disconnect(); });",
  ].join('');
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
    stdio: ['ignore','ignore','pipe','ipc']
  });
  try {
    const events = [];
    const relay = createNativeBrowserSurfaceRelay({
      sendAction: action => {
        if (!child.connected) return false;
        child.send(action, () => undefined);
        return true;
      },
      publish: line => events.push(line),
    });
    const [surface] = await Promise.race([
      once(child, 'message'),
      new Promise((_, reject) => setTimeout(() => reject(Error('Agent IPC timeout')), 9000))
    ]);
    assert.equal(relay.update(surface), true);
    assert.equal(events.length, 1);
    assert.ok(events[0].startsWith(SURFACE_EVENT_PREFIX));
    const receipt = once(child, 'message').then(([value]) => value);
    assert.equal(relay.action(SURFACE_ACTION_PREFIX + JSON.stringify({
      sessionKey:'agent-chat',action:'click',x:0.4,y:0.6
    })), true);
    const actual = await receipt;
    assert.deepEqual(actual.ack, {
      type:'memmy:computer-use-surface:action',surface:'browser',
      sessionKey:'agent-chat',channel:'websocket',chatId:'chat-A',targetId:'active-tab',
      action:'click',x:0.4,y:0.6
    });
    relay.clear();
    assert.equal(relay.action(SURFACE_ACTION_PREFIX + JSON.stringify({
      sessionKey:'agent-chat',action:'reload'
    })), false);
  } finally {
    child.kill();
  }
});
