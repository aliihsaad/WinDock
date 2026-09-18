// Portable, read-only acceptance-ledger status. Never execute CHECK commands.
import { readFile } from "node:fs/promises";
const ledger = await readFile(new URL("../GATES.md", import.meta.url), "utf8");
const gates = [...ledger.matchAll(/^- \[([ x])\] (G\d+): (.+)$/gm)];
const ids = new Set(gates.map(match => match[2]));
if (gates.length !== 18 || ids.size !== 18 || Array.from({ length: 18 }, (_, i) => `G${i}`).some(id => !ids.has(id))) {
  throw new Error("The ledger must contain exactly G0 through G17, once each");
}
for (const [, checked, id, title] of gates) console.log(`${checked === "x" ? "MET    " : "PENDING"} ${id}: ${title}`);
console.log(`${gates.filter(match => match[1] === "x").length}/${gates.length} gates met`);
console.log("STATUS OK — recorded evidence only; no checks were executed");
