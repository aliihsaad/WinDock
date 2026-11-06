import { writeFile } from "node:fs/promises";
import { pairingInvites } from "../../src/pairing-invites.js";

// Synthetic public certificate bytes: realistic QR density, no usable host trust,
// keys or sessions. This fixture cannot authorize a connection to any host.
const fixture = pairingInvites().issue({
  hostId: "11111111-1111-4111-8111-111111111111", name: "WinDock test computer",
  ca: Buffer.alloc(600, 0xa5).toString("base64url"), port: 8622, address: "192.168.1.100",
}, "gif");
await writeFile(process.argv[2], JSON.stringify(fixture));
