import { randomBytes, createHash } from "node:crypto";
import qrcode from "qrcode-generator";
const hash = (s) => createHash("sha256").update(s).digest("hex");
export function pairingInvites({ now = Date.now } = {}) {
  let active = null;
  return {
    clear() { active = null; },
    issue(details, format = "svg") {
      const secret = randomBytes(32).toString("base64url"), expires = now() + 2 * 60000;
      active = { hash: hash(secret), expires };
      const invitation = "windock-pair:" + Buffer.from(JSON.stringify({ v: 1, ...details, secret, expires })).toString("base64url");
      const qr = qrcode(0, "M"); qr.addData(invitation, "Byte"); qr.make();
      return { invitation, ...(format === "gif"
        ? { image: qr.createDataURL(1, 4) }
        : { svg: qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }) }), expires };
    },
    consume(secret) {
      if (typeof secret !== "string" || !/^[\w-]{43}$/.test(secret) || !active || active.expires <= now() || active.hash !== hash(secret)) return false;
      active = null; return true;
    },
  };
}
