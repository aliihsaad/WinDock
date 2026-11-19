import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const events = JSON.parse(await readFile(new URL('../build/fixture/events.json', import.meta.url), 'utf8'));
assert.ok(events.some(event => event.action === 'launch' && event.id === 'ios-1'), 'Paired iOS client must launch a fixture app');
assert.ok(events.some(event => event.action === 'focus' && event.id === 'ios-1'), 'Second tap must reach host focus action');
console.log('Verified iOS app launch and focus reached the isolated Tara host.');
