import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  isBrowserAccessResult, isBrowserCapabilityResult,
  isBrowserDownloadResult, isEmbeddedBrowserResult, isBrowserProfileClearResult,
} from '@memmy/local-api-contracts';
import { unsupportedAgentIpcResponse as deny } from './agent-ipc-deny.mjs';

test('valid permission and download requests are immediately denied, never auto-approved', () => {
  const requestId = randomUUID(), origin = 'https://example.org';
  const access = deny({ type: 'memmy:browser-access:request', requestId, origin, url: origin + '/p' });
  assert.deepEqual(access, {type:'memmy:browser-access:result',requestId,decision:'deny'});
  assert.ok(isBrowserAccessResult(access));
  const cap = deny({ type: 'memmy:browser-capability:request', requestId, capability:'debug',origin,names:['debug'] });
  assert.deepEqual(cap, { type:'memmy:browser-capability:result',requestId,approved:false });
  assert.ok(isBrowserCapabilityResult(cap));
  const download = deny({ type:'memmy:browser-download:request',requestId,name:'file.zip',url:origin });
  assert.deepEqual(download, { type:'memmy:browser-download:result',requestId,filePath:null });
  assert.ok(isBrowserDownloadResult(download));
});
test('unsafe Agent IPC requiring Electron guest execution is rejected without running code', () => {
  const req = deny({type:'memmy:embedded-browser:request',requestId:'request-1',command:'externalBrowserState',args:{}});
  assert.ok(isEmbeddedBrowserResult(req));
  assert.equal(req.ok,false);
  const clear = deny({type:'memmy:browser-profile:clear',requestId:'clear-1'});
  assert.ok(isBrowserProfileClearResult(clear));
  assert.equal(clear.ok,false);
  for(const value of [
    {type:'memmy:browser-access:request',requestId:'bogus'},
    {type:'memmy:browser-access:request',requestId:randomUUID(),origin:'javascript:alert(1)',url:'javascript:alert(1)'},
    {type:'memmy:browser-capability:request',requestId:randomUUID(),capability:'shell',origin:'https://example.org',names:['x']},
    {type:'memmy:computer-use-surface:update',surface:'browser'},
    {type:'arbitrary:command',command:'exec'},
  ]) assert.equal(deny(value),null);
});
