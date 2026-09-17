/** G1: every shipped provider satisfies the platform contract. */
import { createChecker } from "./lib/assert.mjs";
import { contractViolations, PROVIDER_METHODS, PROVIDER_FIELDS } from "../src/platform/contract.js";
import { createProvider, PROVIDERS } from "../src/platform/index.js";

const t = createChecker("contract");
const exec = async () => ({ stdout: "", stderr: "" });

const ids = Object.keys(PROVIDERS);
t.ok(ids.length >= 2, `expected at least two providers, found ${ids.length}`);
t.ok(ids.includes("win32"), "win32 provider is registered");
t.ok(ids.includes("linux"), "linux provider is registered");

for (const os of ids) {
  const provider = createProvider({ os, exec });
  t.deepEqual(contractViolations(provider), [], `${os} satisfies the contract`);
  for (const [method, arity] of Object.entries(PROVIDER_METHODS)) {
    t.equal(typeof provider[method], "function", `${os}.${method} is a function`);
    t.equal(provider[method].length, arity, `${os}.${method} arity`);
  }
  for (const field of PROVIDER_FIELDS) {
    t.ok(typeof provider[field] === "string" && provider[field], `${os}.${field} is a non-empty string`);
  }
}

// Negative control: the detector must actually reject a non-conformant object,
// otherwise the assertions above would pass for anything at all.
const broken = { id: "x", displayName: "X", listInstalledApps() {} };
t.ok(contractViolations(broken).length > 0, "negative control: incomplete provider is rejected");
t.ok(contractViolations(null).length > 0, "negative control: null is rejected");
const wrongArity = { id: "y", displayName: "Y" };
for (const m of Object.keys(PROVIDER_METHODS)) wrongArity[m] = (a, b, c) => [a, b, c];
t.ok(
  contractViolations(wrongArity).some((p) => p.includes("arity")),
  "negative control: wrong arity is reported",
);

t.throws(() => createProvider({ os: "sunos", exec }), "unsupported platform throws");
t.throws(() => createProvider({ os: "win32", exec: null }), "provider without exec throws");

t.done("contract verification passed");
