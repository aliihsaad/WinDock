/** Per-installation CA. A stable TLS name separates authenticated identity from IP routing. */
import "reflect-metadata";
import { webcrypto, X509Certificate, createPrivateKey, createPublicKey, createHash, randomBytes } from "node:crypto";
import { readFile, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import * as x509 from "@peculiar/x509";
import { privateDirectory, writePrivateJson } from "./private-store.js";

const DAY = 86400000;
const ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };
const serial = () => randomBytes(16).toString("hex");
export const tlsName = (id) => `host-${id}.windock.invalid`;
export const certificatePin = (pem) => createHash("sha256").update(new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" })).digest("hex");
const keyMatches = (cert, key) => new X509Certificate(cert).publicKey.equals(createPublicKey(createPrivateKey(key)));
const pemKey = async (key) => createPrivateKey({ key: Buffer.from(await webcrypto.subtle.exportKey("pkcs8", key)), format: "der", type: "pkcs8" }).export({ format: "pem", type: "pkcs8" });
const importKey = (pem) => webcrypto.subtle.importKey("pkcs8", createPrivateKey(pem).export({ format: "der", type: "pkcs8" }), ALG, false, ["sign"]);

async function newAuthority(hostId, now, existing = null) {
  const keys = existing ? {
    privateKey: await importKey(existing.caKey),
    publicKey: await webcrypto.subtle.importKey("spki", new X509Certificate(existing.ca).publicKey.export({ type: "spki", format: "der" }), ALG, true, ["verify"]),
  } : await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({ keys,
    name: `CN=WinDock ${hostId}`, serialNumber: serial(), signingAlgorithm: SIGN,
    notBefore: new Date(now - 5 * 60000), notAfter: new Date(now + 10 * 365 * DAY),
    extensions: [new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey, false, webcrypto)],
  }, webcrypto);
  return { version: 1, hostId, ca: ca.toString("pem"), caKey: existing?.caKey || await pemKey(keys.privateKey) };
}

async function renewLeaf(record, now) {
  const authority = new X509Certificate(record.ca);
  if (Date.parse(authority.validTo) <= now + DAY) throw new Error("WinDock's computer identity has expired. Restore its identity backup or explicitly pair devices with a new identity.");
  const keys = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const cert = await x509.X509CertificateGenerator.create({
    subject: `CN=${tlsName(record.hostId)}`, issuer: authority.subject,
    publicKey: keys.publicKey, signingKey: await importKey(record.caKey), signingAlgorithm: SIGN,
    serialNumber: serial(), notBefore: new Date(now - 5 * 60000),
    notAfter: new Date(Math.min(now + 90 * DAY, Date.parse(authority.validTo))),
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"]),
      new x509.SubjectAlternativeNameExtension([{ type: "dns", value: tlsName(record.hostId) }]),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey, false, webcrypto),
      await x509.AuthorityKeyIdentifierExtension.create(new x509.X509Certificate(record.ca), false, webcrypto)],
  }, webcrypto);
  return { ...record, cert: cert.toString("pem"), key: await pemKey(keys.privateKey) };
}

export async function managedTls(configPath, hostId, { now = Date.now } = {}) {
  if (!configPath || !/^[0-9a-f-]{36}$/.test(hostId)) throw new Error("Managed HTTPS requires a persistent configuration and host identity.");
  const directory = await privateDirectory(`${configPath}.secure`);
  const file = join(directory, "identity.json"), markerFile = `${configPath}.secure-identity`;
  const lock = join(directory, "identity.lock");
  try { await mkdir(lock); }
  catch (error) { if (error.code === "EEXIST") throw new Error("WinDock identity is in use or setup was interrupted. Close other hosts and check the identity directory before retrying."); throw error; }
  let record;
  try {
    let marker;
    try { marker = JSON.parse(await readFile(markerFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw new Error("WinDock identity record is unreadable. Restore it; do not replace it automatically."); }
    try { record = JSON.parse(await readFile(file, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT" || marker) throw new Error("WinDock identity is missing or unreadable. Restore the existing identity before reconnecting.");
      record = await newAuthority(hostId, now());
      record = await renewLeaf(record, now());
      writePrivateJson(file, record);
    }
    if (record.version !== 1 || record.hostId !== hostId || !keyMatches(record.ca, record.caKey) || !keyMatches(record.cert, record.key))
      throw new Error("WinDock identity does not match its saved keys. Restore the matching identity.");
    const ca = new X509Certificate(record.ca), leaf = new X509Certificate(record.cert);
    if (!ca.ca || !ca.verify(ca.publicKey) || !leaf.verify(ca.publicKey) || !leaf.checkHost(tlsName(hostId)))
      throw new Error("WinDock certificate identity is invalid. Restore its identity backup.");
    const pin = certificatePin(record.ca);
    if (marker && (marker.pin !== pin || marker.hostId !== hostId)) throw new Error("WinDock's established identity changed. Explicit recovery is required.");
    if (!marker) writePrivateJson(markerFile, { version: 1, hostId, pin });
  } finally { await rmdir(lock); }
  let refreshing = null;
  const manager = {
    directory, hostId, name: tlsName(hostId),
    get ca() { return record.ca; },
    get publicCa() { return new X509Certificate(record.ca).raw.toString("base64url"); },
    get options() { return { cert: record.cert + "\n" + record.ca, key: record.key }; },
    get expiresAt() { return Date.parse(new X509Certificate(record.cert).validTo); },
    get diagnostics() { return { hostId, tlsName: tlsName(hostId), identityDigest: certificatePin(record.ca),
      certificateExpires: new X509Certificate(record.cert).validTo, authorityExpires: new X509Certificate(record.ca).validTo }; },
    async refresh(server) {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        if (Date.parse(new X509Certificate(record.ca).validFrom) > now()) throw new Error("Computer clock is earlier than its trusted identity.");
        const renewAuthority = Date.parse(new X509Certificate(record.ca).validTo) <= now() + 180 * DAY;
        if (!renewAuthority && manager.expiresAt > now() + 30 * DAY) return false;
        // Renew the CA certificate with the SAME key. The trusted identity is never replaced.
        const authority = renewAuthority ? await newAuthority(hostId, now(), record) : record;
        const updated = await renewLeaf(authority, now());
        writePrivateJson(file, updated);
        record = updated;
        server?.setSecureContext(manager.options);
        return true;
      })();
      try { return await refreshing; } finally { refreshing = null; }
    },
  };
  await manager.refresh();
  return manager;
}
