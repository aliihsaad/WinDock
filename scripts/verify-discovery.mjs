/** G8: UDP discovery answers a valid probe and ignores everything else. */
import { createSocket } from "node:dgram";
import { createChecker } from "./lib/assert.mjs";
import {
  replyFor,
  parseReply,
  startDiscovery,
  primaryAddress,
  PROBE,
  REPLY_PREFIX,
  MAX_PROBE_BYTES,
} from "../src/discovery.js";

const t = createChecker("discovery");
const ENDPOINT = "http://192.168.1.40:8620";

// ---- pure decision function ----
t.equal(replyFor(PROBE, ENDPOINT), `${REPLY_PREFIX}${ENDPOINT}`, "a valid probe is answered");
t.equal(replyFor(Buffer.from(PROBE), ENDPOINT), `${REPLY_PREFIX}${ENDPOINT}`, "a Buffer probe is answered");
t.equal(replyFor(` ${PROBE}\n`, ENDPOINT), `${REPLY_PREFIX}${ENDPOINT}`, "surrounding whitespace is tolerated");

const IGNORED = [
  ["", "empty datagram"],
  ["hello", "unrelated text"],
  ["windock:discover:v0", "wrong protocol version"],
  ["windock:discover", "truncated probe"],
  ["WINDOCK:DISCOVER:V1", "wrong case"],
  [`${PROBE}extra`, "probe with trailing junk"],
  ["x".repeat(MAX_PROBE_BYTES + 1), "oversized datagram"],
  [null, "null message"],
  [42, "non-string message"],
];
for (const [msg, label] of IGNORED) {
  t.equal(replyFor(msg, ENDPOINT), null, `ignored: ${label}`);
}
t.equal(replyFor(PROBE, ""), null, "no reply without a known endpoint");
t.equal(replyFor(PROBE, null), null, "no reply when the endpoint is null");

// Boundary: exactly at the cap is still answered when it is the real probe.
t.ok(Buffer.byteLength(PROBE) <= MAX_PROBE_BYTES, "the probe itself fits the size cap");

t.equal(parseReply(`${REPLY_PREFIX}${ENDPOINT}`), ENDPOINT, "a reply parses back to the endpoint");
t.equal(parseReply("garbage"), null, "an unrelated reply parses to null");
t.equal(parseReply(REPLY_PREFIX), null, "an empty endpoint parses to null");

// ---- live round trip on the loopback interface ----
const PORT = 41999;
const responder = startDiscovery({ port: PORT, endpoint: ENDPOINT });
await responder.ready;

function ask(payload, timeoutMs = 700) {
  return new Promise((resolve) => {
    const client = createSocket("udp4");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    client.on("message", (msg) => {
      clearTimeout(timer);
      finish(msg.toString("utf8"));
    });
    client.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    client.send(payload, PORT, "127.0.0.1");
  });
}

const answered = await ask(PROBE);
t.equal(answered, `${REPLY_PREFIX}${ENDPOINT}`, "live responder answers a real probe");
t.equal(parseReply(answered), ENDPOINT, "a device can recover the endpoint from the live reply");

// Negative control: the same live socket must stay silent for junk. Without the
// positive result above, silence here could simply mean the socket is dead.
t.equal(await ask("garbage"), null, "live responder stays silent for junk");
t.equal(await ask("x".repeat(MAX_PROBE_BYTES + 1)), null, "live responder stays silent for oversized traffic");

await responder.close();

const addr = primaryAddress();
t.ok(addr === null || /^\d+\.\d+\.\d+\.\d+$/.test(addr), `primary address is an IPv4 address or null (${addr})`);
t.equal(
  primaryAddress({ lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] }),
  null,
  "a loopback-only host advertises no address",
);
t.equal(
  primaryAddress({ eth0: [{ family: "IPv4", internal: false, address: "10.1.2.3" }] }),
  "10.1.2.3",
  "the first external IPv4 address is chosen",
);

t.done("discovery verification passed");
