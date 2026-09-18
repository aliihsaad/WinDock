// Explicit Windows hardware test: one small brightness change, always restored.
// Run separately from npm test; optionally exercise the live loopback HTTP API.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createExec } from '../src/platform/index.js';
import { createWindowsProvider } from '../src/platform/windows.js';

const { values } = parseArgs({ options: { helper: { type: 'string' }, 'base-url': { type: 'string' } } });
assert.equal(process.platform, 'win32', 'This check requires a physical Windows display.');
const helper = resolve(values.helper || 'artifacts/WinDock-win-x64/WinDockHelper.exe');
const exec = createExec();
const provider = createWindowsProvider({ exec, helperPath: helper });
const read = async () => JSON.parse((await exec(helper, ['brightness'])).stdout).displays;
const before = await read();
assert.equal(before.length, 1, 'Only test one controllable display, so its exact level can be restored.');
const original = before[0];
const raw = percent => original.min + Math.round((original.max - original.min) * percent / 100);
assert.equal(raw(original.percent), original.current, 'Skip a fractional level that cannot be restored through the percentage API.');
const target = original.percent <= 90 ? original.percent + 5 : original.percent - 5;
let endpoint;
if (values['base-url']) {
  endpoint = new URL('/api/control', values['base-url']);
  assert.equal(endpoint.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Only a loopback test host is permitted.');
}
try {
  if (endpoint) {
    const result = await fetch(endpoint, {
      method: 'POST', headers: { origin: endpoint.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ verb: 'brightness-set', value: target }), signal: AbortSignal.timeout(25000),
    });
    assert.equal(result.status, 200, await result.text());
  } else await provider.control('brightness-set', target);
  const after = await read();
  assert.equal(after.length, 1);
  assert.equal(after[0].current, raw(target), 'The monitor must report the requested brightness.');
  console.log(`PASS ${endpoint ? 'HTTP → ' : ''}Windows helper → ${original.method}: ${original.percent}% → ${target}%`);
} finally {
  await provider.control('brightness-set', original.percent);
  const restored = await read();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].current, original.current, 'Original hardware brightness must be restored.');
  console.log(`PASS restored original monitor brightness: ${original.percent}%`);
}
