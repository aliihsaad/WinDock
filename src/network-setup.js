/** Read-only connection guidance. Never elevates, runs a shell, or changes firewall rules. */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';

const quoteSh = text => `'${text.replaceAll("'", "'\\''")}'`;
const quotePs = text => `'${text.replaceAll("'", "''")}'`;
const validText = text => typeof text === 'string' && text.length > 0 && text.length < 512 && !/[\x00-\x1f\x7f]/.test(text);
const number = address => address.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0);
const addressOf = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
const privateAddress = ip => ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

export function localScopes(interfaces = networkInterfaces()) {
  const scopes = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!validText(name) || /tailscale|zerotier|wireguard|vpn|^tun\d*|^tap\d*|vethernet|hyper-v|vmware|virtualbox|vbox|docker|^br-|^virbr|^veth/i.test(name)) continue;
    for (const entry of entries || []) {
      if (entry.internal || !['IPv4', 4].includes(entry.family) || !isIPv4(entry.address) ||
          !isIPv4(entry.netmask) || !privateAddress(entry.address)) continue;
      const mask = number(entry.netmask), inverse = (~mask) >>> 0;
      // Reject noncontiguous masks, /0 and ranges extending outside private LAN space.
      if ((inverse & (inverse + 1)) !== 0 || mask === 0) continue;
      const start = (number(entry.address) & mask) >>> 0, end = (start | inverse) >>> 0;
      if (!privateAddress(addressOf(start)) || !privateAddress(addressOf(end))) continue;
      const prefix = mask.toString(2).replaceAll('0', '').length;
      const scope = { name, address: entry.address, subnet: `${addressOf(start)}/${prefix}` };
      if (!scopes.some(item => item.name === name && item.subnet === scope.subnet)) scopes.push(scope);
      if (scopes.length === 8) return scopes;
    }
  }
  return scopes;
}

export function firewallCommands({ platform, backend, scope, ports, executable, zone }) {
  // Treat everything used in displayed commands as data too: copying must be safe.
  if (!scope || !validText(scope.name) || !isIPv4(scope.address) ||
      !/^\d+\.\d+\.\d+\.\d+\/(\d|[12]\d|3[0-2])$/.test(scope.subnet)) return [];
  const [base, bits] = scope.subnet.split('/'), prefix = Number(bits);
  if (!isIPv4(base) || prefix === 0) return [];
  const mask = (0xffffffff << (32 - prefix)) >>> 0, start = number(base), end = (start | ~mask) >>> 0;
  if (((number(scope.address) & mask) >>> 0) !== start || !privateAddress(base) || !privateAddress(addressOf(end))) return [];
  return ports.filter(port => Number.isInteger(port.port) && port.port > 0 && port.port <= 65535 && ['tcp', 'udp'].includes(port.protocol)).map(port => {
    let commands = [];
    if (platform === 'linux' && backend === 'ufw') {
      commands = [`sudo ufw allow in on ${quoteSh(scope.name)} from ${scope.subnet} to any port ${port.port} proto ${port.protocol} comment 'WinDock local network'`];
    } else if (platform === 'linux' && backend === 'firewalld' && /^[A-Za-z0-9_-]{1,64}$/.test(zone || '')) {
      const rule = `rule family="ipv4" source address="${scope.subnet}" port port="${port.port}" protocol="${port.protocol}" accept`;
      commands = [false, true].map(permanent => `sudo firewall-cmd --zone=${quoteSh(zone)} ${permanent ? '--permanent ' : ''}--add-rich-rule=${quoteSh(rule)}`);
    } else if (platform === 'win32' && validText(executable) && /^[A-Za-z]:\\/.test(executable)) {
      commands = [`New-NetFirewallRule -DisplayName 'WinDock ${port.protocol.toUpperCase()} ${port.port}' -Direction Inbound -Action Allow -Profile Private -Program ${quotePs(executable)} -Protocol ${port.protocol.toUpperCase()} -LocalPort ${port.port} -LocalAddress ${scope.address} -RemoteAddress ${scope.subnet}`];
    }
    return { ...port, commands };
  });
}

function runReadOnly(file, args) {
  return new Promise(resolve => execFile(file, args, { timeout: 2000, maxBuffer: 65536, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
    (error, stdout) => resolve({ ok: !error, text: String(stdout || '').trim() })));
}

export async function networkSetup({ ports, platform = process.platform, interfaces = networkInterfaces(), executable = process.execPath,
  read = readFile, run = runReadOnly } = {}) {
  const scopes = localScopes(interfaces);
  let backend = 'unknown', status = 'Firewall access has not been verified. A local listener cannot prove that a phone can reach it.';
  if (platform === 'linux') {
    const [ufw, firewalld] = await Promise.all([
      read('/etc/ufw/ufw.conf', 'utf8').catch(() => ''), run('firewall-cmd', ['--state'])
    ]);
    const ufwEnabled = /^ENABLED=yes\s*$/m.test(ufw);
    if (ufwEnabled && firewalld.ok && firewalld.text === 'running') {
      status = 'UFW and firewalld are both enabled. Ask your administrator to review both; no automatic rule plan is available.';
    } else if (ufwEnabled) {
      backend = 'ufw';
      const check = await run('ufw', ['status', 'numbered']);
      status = check.ok ? `UFW reports:\n${check.text}\nCheck the ports below against these rules; other policies can still block access.`
        : 'UFW is configured. Administrator access is needed to inspect its effective rules. Run sudo ufw status numbered on this computer.';
    } else if (firewalld.ok && firewalld.text === 'running') {
      backend = 'firewalld';
      status = 'firewalld is running. Review rules for the zone of the network used by your phone. Zone rules also apply to other interfaces in that zone.';
    } else {
      status = 'No active UFW/firewalld configuration was detected. This does not rule out nftables, another firewall, a VPN or router isolation. Ask your administrator if the secure port is unreachable.';
    }
  } else if (platform === 'win32') {
    backend = 'windows';
    status = 'Windows setup relies on the Windows firewall prompt. Allow the bundled WinDock runtime on your trusted Private network. If needed, review the commands below in PowerShell opened as administrator. Existing block or organization policies can override allow rules.';
  }
  const networks = await Promise.all(scopes.map(async scope => {
    let zone;
    if (backend === 'firewalld') {
      const result = await run('firewall-cmd', ['--get-zone-of-interface', scope.name]);
      if (result.ok && /^[A-Za-z0-9_-]{1,64}$/.test(result.text)) zone = result.text;
    }
    return { ...scope, zone, rules: firewallCommands({ platform, backend, scope, ports, executable, zone }) };
  }));
  return { platform, backend, status, ports, networks,
    note: 'Choose only the network shared with your phone. Review before running any command; your computer will request administrator permission. WinDock has not changed your firewall. After changes, generate a fresh QR and test from the phone. USB tethering can use a different interface/subnet. Recheck after a port or network change. Never disable the firewall or forward router ports.' };
}
