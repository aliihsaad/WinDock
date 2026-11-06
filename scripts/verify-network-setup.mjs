import assert from 'node:assert/strict';
import { localScopes, firewallCommands, networkSetup } from '../src/network-setup.js';
const entry = (address, netmask = '255.255.255.0') => ({ family: 'IPv4', internal: false, address, netmask });
const interfaces = { eno1: [entry('192.168.178.119')], usb0: [entry('192.168.42.10')], lo: [{ ...entry('127.0.0.1'), internal: true }],
  vpn: [entry('100.120.172.5')], 'vEthernet (WSL)': [entry('172.23.240.1')], wan: [entry('50.50.50.241')], bad: [entry('10.1.2.3', '255.0.255.0')], broad: [entry('192.168.1.2', '255.0.0.0')] };
const scopes = localScopes(interfaces);
assert.deepEqual(scopes.map(scope => scope.subnet), ['192.168.178.0/24', '192.168.42.0/24']);
const ports = [{ port: 19876, protocol: 'tcp', label: 'Secure' }, { port: 41234, protocol: 'udp', label: 'Discovery' }];
const calls = [];
const run = async (file, args) => { calls.push([file, args]); return { ok: false, text: '' }; };
const ufw = await networkSetup({ ports, platform: 'linux', interfaces, read: async () => 'ENABLED=yes\n', run });
assert.equal(ufw.backend, 'ufw'); assert.match(ufw.status, /Administrator access/);
assert.ok(ufw.networks[0].rules[0].commands[0].includes("on 'eno1' from 192.168.178.0/24 to any port 19876"));
assert.ok(ufw.networks[1].rules[0].commands[0].includes("on 'usb0' from 192.168.42.0/24"));
assert.deepEqual(calls, [['firewall-cmd', ['--state']], ['ufw', ['status', 'numbered']]]); // read-only command allowlist
const firewalld = await networkSetup({ ports, platform: 'linux', interfaces, read: async () => '',
  run: async (file, args) => ({ ok: true, text: args[0] === '--state' ? 'running' : 'home' }) });
assert.equal(firewalld.backend, 'firewalld');
assert.match(firewalld.networks[0].rules[0].commands[0], /source address="192.168.178.0\/24".*port="19876"/);
assert.match(firewalld.networks[0].rules[0].commands[1], /--permanent/);
assert.ok(!JSON.stringify(firewalld).includes('--reload')); // do not reload/drop other runtime rules
const conflict = await networkSetup({ ports, platform: 'linux', interfaces, read: async () => 'ENABLED=yes', run: async () => ({ ok: true, text: 'running' }) });
assert.equal(conflict.backend, 'unknown'); assert.ok(conflict.networks.every(n => n.rules.every(r => !r.commands.length)));
const unknown = await networkSetup({ ports, platform: 'linux', interfaces, read: async () => { throw Error(); }, run });
assert.equal(unknown.backend, 'unknown'); assert.match(unknown.status, /does not rule out/);
const noZone = await networkSetup({ ports, platform: 'linux', interfaces, read: async () => '',
  run: async (file, args) => ({ ok: true, text: args[0] === '--state' ? 'running' : 'no zone' }) });
assert.ok(noZone.networks.every(n => n.rules.every(r => !r.commands.length)));
const windows = await networkSetup({ ports, platform: 'win32', interfaces, executable: "C:\\A user's PC\\WinDock\\node.exe", run: async () => { throw Error('Must not run commands'); } });
const ps = windows.networks[0].rules[0].commands[0];
assert.match(ps, /-Profile Private/); assert.match(ps, /-RemoteAddress 192\.168\.178\.0\/24/);
assert.match(ps, /-Program 'C:\\A user''s PC\\WinDock\\node.exe'/); assert.match(ps, /-LocalPort 19876/);
assert.ok(!ps.includes('-Profile Any'));
assert.equal(firewallCommands({ platform: 'linux', backend: 'ufw', scope: { ...scopes[0], name: 'bad\ncommand' }, ports }).length, 0);
assert.equal(firewallCommands({ platform: 'linux', backend: 'ufw', scope: { ...scopes[0], subnet: '0.0.0.0/0' }, ports }).length, 0);
assert.equal(firewallCommands({ platform: 'linux', backend: 'ufw', scope: { ...scopes[0], subnet: '192.0.0.0/8' }, ports }).length, 0);
assert.equal(firewallCommands({ platform: 'linux', backend: 'ufw', scope: { ...scopes[0], subnet: '10.0.0.0/24' }, ports }).length, 0);
assert.equal(firewallCommands({ platform: 'linux', backend: 'ufw', scope: scopes[0], ports: [{ port: 0, protocol: 'tcp' }] }).length, 0);
assert.equal(firewallCommands({ platform: 'linux', backend: 'firewalld', scope: scopes[0], zone: 'home;bad', ports })[0].commands.length, 0);
console.log('network-setup verification passed');
