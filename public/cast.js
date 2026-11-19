const $ = (id) => document.getElementById(id);
const status = (text, error = false) => { $("status").textContent = text; $("status").dataset.error = String(error); };
async function send(text) {
  const clean = String(text || "").trim().split(/\r?\n/).find((l) => l && !l.startsWith("#")) || "";
  if (!clean) return status("That wasn’t a link.", true);
  try {
    const res = await fetch("/api/cast/send", { method: "POST", headers: { "content-type": "application/json", "x-windock-cast": "local" }, body: JSON.stringify({ url: clean }), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not send.");
    status("Sent. It should open on your phone in a few seconds.");
  } catch (error) { status(error.message, true); }
}
const drop = $("drop");
for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (e) => { e.preventDefault(); drop.dataset.over = "true"; });
for (const type of ["dragleave", "drop"]) drop.addEventListener(type, (e) => { e.preventDefault(); drop.dataset.over = "false"; });
drop.addEventListener("drop", (e) => send(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")));
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());
$("form").addEventListener("submit", (e) => { e.preventDefault(); send($("link").value); $("link").value = ""; });
document.addEventListener("paste", (e) => { if (document.activeElement?.id !== "link") send(e.clipboardData.getData("text")); });

// Assistant AI key: saved on this PC only; the page never reads it back.
const aiStatus = (text, error = false) => { $("ai-status").textContent = text; $("ai-status").style.color = error ? "#ed9695" : ""; };
$("ai-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await fetch("/api/assistant/key", { method: "POST", headers: { "content-type": "application/json", "x-windock-assistant": "local" }, body: JSON.stringify({ key: $("ai-key").value.trim() }), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not save the key.");
    $("ai-key").value = "";
    aiStatus(body.configured ? "Saved. The assistant can now answer questions." : "Key removed. The assistant now only does PC commands.");
  } catch (error) { aiStatus(error.message, true); }
});
