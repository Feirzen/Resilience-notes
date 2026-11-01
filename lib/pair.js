// Phone camera pairing (computer side). Shows a QR code; the phone opens scan/camera.html,
// and each picture arrives here peer-to-peer. Pictures live only in this page's memory.
// Needs window.Peer (vendor/peerjs.min.js) and window.qrcode (vendor/qrcode.js).
export function startPairing({ qrEl, onCode, onStatus, onImage, signal }) {
  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
  const code = String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, "0");
  const id = "rnotes-" + rand(12);
  let conn = null;
  onCode?.(code); onStatus?.("Getting ready…", "");
  const peer = new window.Peer(id, signal || undefined);
  peer.on("open", () => {
    const url = new URL("scan/camera.html", location.href.split("#")[0]);
    url.hash = id + "." + code;
    const qr = window.qrcode(0, "M"); qr.addData(url.href); qr.make();
    qrEl.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
    qrEl.hidden = false;
    onStatus?.("Scan with your phone", "");
  });
  peer.on("connection", c => {
    if (conn || c.metadata?.code !== code) { c.on("open", () => c.close()); return; }
    conn = c;
    c.on("open", () => { onStatus?.("Phone connected", "on"); qrEl.hidden = true; });
    c.on("data", d => { if (d?.type === "image") onImage?.(new Blob([d.buf], { type: "image/jpeg" })); });
    c.on("close", () => { conn = null; onStatus?.("Phone disconnected", "bad"); });
  });
  peer.on("error", e => onStatus?.("Connection problem: " + e.type, "bad"));
  return { stop: () => { try { peer.destroy(); } catch {} } };
}
