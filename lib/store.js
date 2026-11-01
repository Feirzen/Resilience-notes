// Folder storage. Real mode: the team folder on the U: drive, opened through Edge's
// "choose a folder" permission. Demo mode: a private scratch folder inside this browser.
// The app writes Word files next to the notes and keeps its own data in "_app-data".
import { UNITS } from "./layout.js";

const DB = "resilience-notes", KEY = "root";
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("h");
    open.onsuccess = () => {
      const tx = open.result.transaction("h", mode), st = tx.objectStore("h"), r = fn(st);
      tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error);
    };
    open.onerror = () => rej(open.error);
  });
}

export const supported = () => "showDirectoryPicker" in window;

export class Store {
  constructor(root, demo = false) { this.root = root; this.demo = demo; this.revs = {}; }

  static async pick() {
    const root = await window.showDirectoryPicker({ id: "tomco", mode: "readwrite" });
    await idb("readwrite", st => st.put(root, KEY));
    return new Store(root);
  }
  // Returns { store } if the folder is still allowed, { needsClick: handle } if Edge wants a click first.
  static async restore() {
    try {
      const root = await idb("readonly", st => st.get(KEY));
      if (!root) return {};
      const perm = await root.queryPermission({ mode: "readwrite" });
      return perm === "granted" ? { store: new Store(root) } : { needsClick: root };
    } catch { return {}; }
  }
  static async regrant(root) {
    return (await root.requestPermission({ mode: "readwrite" })) === "granted" ? new Store(root) : null;
  }
  static async forget() { try { await idb("readwrite", st => st.delete(KEY)); } catch {} }
  static async demoStore() {
    const opfs = await navigator.storage.getDirectory();
    return new Store(await opfs.getDirectoryHandle("demo-tomco-team", { create: true }), true);
  }
  static async wipeDemo() { const o = await navigator.storage.getDirectory(); try { await o.removeEntry("demo-tomco-team", { recursive: true }); } catch {} }

  get name() { return this.demo ? "Demo folder (fake patients)" : this.root.name; }

  async dir(parent, name, create = false) {
    try { return await parent.getDirectoryHandle(name, { create }); } catch { return null; }
  }
  async data() { return this.dir(this.root, "_app-data", true); }
  async entries(dir) { const out = []; for await (const [name, h] of dir.entries()) out.push({ name, h }); return out; }

  // unit folder: any folder whose name contains the unit name ("1 TIMP", "3. Nebo", ...)
  async unitDir(unit, create = false) {
    for (const e of await this.entries(this.root))
      if (e.h.kind === "directory" && e.name.toLowerCase().includes(unit.toLowerCase())) return e.h;
    return create ? this.dir(this.root, `${UNITS.indexOf(unit) + 1} ${unit}`, true) : null;
  }
  // "admit" or "discharge" folder inside a unit folder
  async subDir(unitDir, kind) {
    const want = kind === "admit" ? /admit/i : /discharg/i;
    for (const e of await this.entries(unitDir)) if (e.h.kind === "directory" && want.test(e.name)) return e.h;
    return this.dir(unitDir, kind === "admit" ? "Admits" : "Discharges", true);
  }
  async docxIn(dir) {
    return (await this.entries(dir)).filter(e => e.h.kind === "file" && /\.docx$/i.test(e.name) && !e.name.startsWith("~$"));
  }

  async readText(dir, name) { try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch { return null; } }
  async readJSON(dir, name, fallback = null) { const t = await this.readText(dir, name); try { return t ? JSON.parse(t) : fallback; } catch { return fallback; } }
  async write(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
    return (await fh.getFile()).lastModified;
  }
  async writeJSON(dir, name, obj) { return this.write(dir, name, JSON.stringify(obj, null, 1)); }
  async move(from, name, to, newName = name) {
    const f = await (await from.getFileHandle(name)).getFile();
    await this.write(to, newName, await f.arrayBuffer());
    await from.removeEntry(name);
  }
  async exists(dir, name) { try { await dir.getFileHandle(name); return true; } catch { return false; } }

  // ---------- patients ----------
  async patientsDir() { return this.dir(await this.data(), "patients", true); }
  async loadPatients() {
    const dir = await this.patientsDir(), out = [];
    const files = (await this.entries(dir)).filter(e => e.h.kind === "file" && e.name.endsWith(".json"));
    await Promise.all(files.map(async e => {
      try { const pt = JSON.parse(await (await e.h.getFile()).text()); this.revs[pt.id] = pt.rev || 0; out.push(pt); } catch {}
    }));
    return out;
  }
  // Saves one patient. Each save bumps a version number inside the file. If the file on the
  // drive has a newer version than the one we loaded, another computer saved it: "conflict".
  async savePatient(pt, force = false) {
    const dir = await this.patientsDir(), name = pt.id + ".json";
    const onDisk = await this.readJSON(dir, name, null);
    const diskRev = onDisk?.rev || 0, mine = this.revs[pt.id];
    if (!force && onDisk && mine !== undefined && diskRev > mine) return "conflict";
    pt.rev = Math.max(diskRev, mine || 0) + 1;
    await this.writeJSON(dir, name, pt);
    this.revs[pt.id] = pt.rev;
    return "ok";
  }
  async reloadPatient(id) {
    const pt = await this.readJSON(await this.patientsDir(), id + ".json", null);
    this.revs[id] = pt?.rev || 0; return pt;
  }

  // ---------- shared app files ----------
  async getShared(name, fallback) { return this.readJSON(await this.data(), name, fallback); }
  async setShared(name, obj) { return this.writeJSON(await this.data(), name, obj); }
}
