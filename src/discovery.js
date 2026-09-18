/**
 * LAN discovery.
 *
 * A device broadcasts a fixed probe on the discovery port; the host replies with
 * its HTTP endpoint so the phone never needs a typed IP address. The reply
 * carries no secret: it advertises where the host is, not who may use it. The
 * PIN still gates every API route, so an attacker learning the URL gains
 * nothing they could not learn by scanning the subnet.
 */

import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";

export const DISCOVERY_PORT = 41234;
export const PROBE = "windock:discover:v1";
export const REPLY_PREFIX = "windock:here:v1:";
export const MAX_PROBE_BYTES = 64;

/** Prefer a physical LAN adapter over VPNs and VM/container networks. */
export function primaryAddress(interfaces = networkInterfaces(), preferred = "") {
  const candidates = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const entry of list || []) {
      const family = entry.family === 4 || entry.family === "IPv4";
      if (!family || entry.internal || !isIPv4(entry.address || "")) continue;
      const [a, b] = entry.address.split(".").map(Number);
      if (a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254)) continue;
      const virtual = /tailscale|zerotier|wireguard|vpn|^tun\d*|^tap\d*|vethernet|hyper-v|vmware|virtualbox|vbox|docker|^br-|^virbr|^veth/i.test(name);
      const privateIp = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
      candidates.push({ address: entry.address, score: (virtual ? 0 : 10) + (privateIp ? 2 : 0) });
    }
  }
  if (preferred) {
    if (!isIPv4(preferred) || !candidates.some((entry) => entry.address === preferred)) {
      throw new Error("WINDOCK_HOST must be an IPv4 address assigned to this computer");
    }
    return preferred;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address || null;
}

/**
 * Decide the reply for one datagram.
 * Returns the reply string, or null when the datagram must be ignored.
 * Oversized or unrecognized traffic is ignored so the socket cannot be used as
 * an amplifier or a reflection target.
 */
export function replyFor(message, endpoint) {
  if (!Buffer.isBuffer(message) && typeof message !== "string") return null;
  const buf = Buffer.isBuffer(message) ? message : Buffer.from(message, "utf8");
  if (buf.length === 0 || buf.length > MAX_PROBE_BYTES) return null;
  if (buf.toString("utf8").trim() !== PROBE) return null;
  if (typeof endpoint !== "string" || !endpoint) return null;
  return `${REPLY_PREFIX}${endpoint}`;
}

export function parseReply(message) {
  const text = Buffer.isBuffer(message) ? message.toString("utf8") : String(message ?? "");
  if (!text.startsWith(REPLY_PREFIX)) return null;
  const endpoint = text.slice(REPLY_PREFIX.length).trim();
  return endpoint || null;
}

/**
 * Start the responder.
 * @returns {{close:()=>Promise<void>, port:number}}
 */
export function startDiscovery({ port = DISCOVERY_PORT, endpoint, socket } = {}) {
  const sock = socket || createSocket({ type: "udp4", reuseAddr: true });

  sock.on("message", (msg, rinfo) => {
    const reply = replyFor(msg, typeof endpoint === "function" ? endpoint() : endpoint);
    if (!reply) return;
    sock.send(reply, rinfo.port, rinfo.address, () => {});
  });

  sock.on("error", () => {
    /* A bound-port conflict must not take the dock down; HTTP still works. */
  });

  const ready = new Promise((resolve) => {
    sock.bind(port, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* not fatal */
      }
      resolve();
    });
  });

  return {
    port,
    ready,
    close() {
      return new Promise((resolve) => sock.close(resolve));
    },
  };
}
