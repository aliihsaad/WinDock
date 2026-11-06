const button = document.getElementById("create"), status = document.getElementById("status");
const qrDialog = document.getElementById("qr-dialog"), qr = document.getElementById("qr"), qrStatus = document.getElementById("qr-status");
document.getElementById("close-qr").onclick = () => qrDialog.close();
document.getElementById("refresh-qr").onclick = () => button.click();
function fitCode() {
  const image = qr.querySelector("canvas");
  if (!image?.width) return;
  const ratio = window.devicePixelRatio || 1;
  const available = Math.max(1, Math.min(qr.clientWidth, innerHeight - 210));
  // The one-pixel source includes a four-module quiet zone. Scale whole modules
  // to whole physical pixels, matching the native Windows pairing window.
  const scale = Math.max(1, Math.floor(available * ratio / image.width));
  image.style.width = `${image.width * scale / ratio}px`;
}
window.addEventListener("resize", fitCode);
document.getElementById("forget").onclick = async () => {
  if (!confirm("Forget all paired HTTPS phones? You will need to pair them again.")) return;
  try {
    const response = await fetch("/api/pairing/revoke", { method: "POST", headers: { "content-type": "application/json", "x-windock-pair": "local" }, body: '{"confirm":"forget-all"}' });
    if (!response.ok) throw new Error();
    status.textContent = "Paired phones were signed out. Show a new code to pair again.";
  } catch { status.textContent = "Couldn't forget paired phones. Check WinDock and retry."; }
};
let expiry;
document.getElementById("check-network").onclick = async () => {
  const action = document.getElementById("check-network"), output = document.getElementById("network-result");
  action.disabled = true; output.textContent = "Checking this computer…";
  try {
    const response = await fetch("/api/pairing/network", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json(); output.replaceChildren();
    function line(parent, tag, text) { const element = document.createElement(tag); element.textContent = text; parent.append(element); return element; }
    line(output, "p", data.status);
    line(output, "p", "Current ports: " + data.ports.map(port => `${port.label}: ${port.port}/${port.protocol}`).join("; "));
    line(output, "p", data.note);
    if (!data.networks.length) line(output, "p", "No private IPv4 network is available for a scoped rule. Connect Wi-Fi or USB tethering, then check again.");
    for (const network of data.networks) {
      const section = document.createElement("details"); output.append(section);
      line(section, "summary", `${network.name} · ${network.address} · ${network.subnet}` + (network.zone ? ` · zone ${network.zone}` : ""));
      const rules = network.rules.filter(rule => rule.commands.length);
      if (!rules.length) line(section, "p", "No safe rule plan is available for this firewall. Ask your administrator to allow the required ports from this network.");
      for (const rule of rules) {
        line(section, "p", rule.label);
        const field = line(section, "textarea", ""); field.readOnly = true;
        field.value = rule.commands.join("\n"); field.setAttribute("aria-label", `${rule.label} commands for ${network.name}`);
        const copy = line(section, "button", "Copy command"); copy.type = "button";
        copy.onclick = async () => {
          try { await navigator.clipboard.writeText(field.value); copy.textContent = "Copied"; }
          catch { field.focus(); field.select(); copy.textContent = "Selected — copy the text"; }
        };
      }
    }
  } catch { output.textContent = "Connection checks are unavailable. Confirm the companion is updated and running, then retry."; }
  finally { action.disabled = false; }
};
if (location.hash === "#network") document.getElementById("network").open = true;
document.getElementById("diagnose").onclick = async () => {
  try {
    const response = await fetch("/api/pairing/diagnostics", { cache: "no-store" });
    if (!response.ok) throw new Error();
    document.getElementById("diagnostics").textContent = JSON.stringify(await response.json(), null, 2);
  } catch { document.getElementById("diagnostics").textContent = "Diagnostics unavailable. Restart WinDock and retry."; }
};
button.onclick = async () => {
  button.disabled = true; document.getElementById("refresh-qr").disabled = true; clearTimeout(expiry);
  qr.replaceChildren(); qrStatus.textContent = "Preparing a new code…";
  document.getElementById("manual").hidden = true;
  document.getElementById("invitation").value = "";
  try {
    const response = await fetch("/api/pairing/invite", { method: "POST", headers: { "content-type": "application/json", "x-windock-pair": "local" }, body: '{"format":"gif"}', cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!/^data:image\/gif;base64,[A-Za-z0-9+/=]{20,200000}$/.test(data.image || "")) throw new Error();
    // Decode local bytes directly; the pairing page's existing strict CSP stays unchanged.
    const bytes = Uint8Array.from(atob(data.image.split(",")[1]), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/gif" }));
    if (bitmap.width > 185 || bitmap.width !== bitmap.height) { bitmap.close(); throw new Error(); }
    const image = document.createElement("canvas"); image.width = bitmap.width; image.height = bitmap.height;
    image.setAttribute("role", "img"); image.setAttribute("aria-label", "Scan this pairing code using WinDock");
    const drawing = image.getContext("2d"); drawing.imageSmoothingEnabled = false;
    drawing.drawImage(bitmap, 0, 0); bitmap.close();
    qr.append(image);
    if (!qrDialog.open) qrDialog.showModal();
    fitCode();
    document.getElementById("invitation").value = data.invitation;
    document.getElementById("manual").hidden = false;
    status.textContent = "Scan this code now. It expires in two minutes and can pair one device.";
    qrStatus.textContent = status.textContent;
    expiry = setTimeout(() => { qr.replaceChildren(); document.getElementById("invitation").value = ""; document.getElementById("manual").hidden = true; status.textContent = "Code expired. Show a new code to continue."; qrStatus.textContent = status.textContent; }, Math.max(0, data.expires - Date.now()));
    button.textContent = "Show a new code";
  } catch { status.textContent = "Couldn't create a pairing code. Check that WinDock is running, then try again."; qrStatus.textContent = status.textContent; }
  finally { button.disabled = false; document.getElementById("refresh-qr").disabled = false; }
};
