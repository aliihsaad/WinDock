/**
 * Wake-on-LAN. A magic packet is six 0xFF bytes followed by the target's MAC
 * address sixteen times, sent as a UDP broadcast. The sender is an already
 * awake WinDock PC, so the phone never needs to reach a sleeping computer.
 */
import dgram from "node:dgram";
import os from "node:os";

const MAC_PATTERN = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i;

/** Normalise a MAC address to upper-case colon form, or return null. */
export function normalizeMac(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!MAC_PATTERN.test(text)) return null;
  const hex = text.replace(/[:-]/g, "").toUpperCase();
  if (/^0+$/.test(hex) || /^F+$/.test(hex)) return null;
  return hex.match(/../g).join(":");
}

export function magicPacket(mac) {
  const normalized = normalizeMac(mac);
  if (!normalized) throw new Error("invalid MAC address");
  const bytes = Buffer.from(normalized.replaceAll(":", ""), "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/** Directed broadcast addresses of this machine's IPv4 networks, plus the limited broadcast. */
export function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const found = new Set(["255.255.255.255"]);
  for (const list of Object.values(interfaces)) {
    for (const item of list || []) {
      if (item.family !== "IPv4" || item.internal || !item.netmask) continue;
      const ip = item.address.split(".").map(Number);
      const mask = item.netmask.split(".").map(Number);
      if (ip.length !== 4 || mask.length !== 4 || [...ip, ...mask].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
      found.add(ip.map((part, i) => (part | (~mask[i] & 255)) & 255).join("."));
    }
  }
  return [...found];
}

/**
 * Send the packet to every broadcast address on ports 9 and 7.
 * `createSocket` and `addresses` are injectable so tests never touch the network.
 */
export async function sendWake(mac, { createSocket = () => dgram.createSocket("udp4"), addresses = broadcastAddresses() } = {}) {
  const packet = magicPacket(mac);
  const socket = createSocket();
  try {
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, () => {
        try { socket.setBroadcast(true); resolve(); } catch (error) { reject(error); }
      });
    });
    let sent = 0;
    for (const address of addresses) {
      for (const port of [9, 7]) {
        await new Promise((resolve) => socket.send(packet, port, address, (error) => { if (!error) sent += 1; resolve(); }));
      }
    }
    if (!sent) throw new Error("no network accepted the wake packet");
    return { sent };
  } finally {
    try { socket.close(); } catch { /* already closed */ }
  }
}
