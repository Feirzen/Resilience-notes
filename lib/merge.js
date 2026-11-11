// Three-way merge of one patient record: base (the version this computer last loaded or saved),
// mine (this computer's edits) and theirs (what another computer saved meanwhile).
// Rule everywhere: if only one side changed something, take that side. If both changed the same thing
// differently, keep mine and report it as a clash so a person can pick.
// Returns { merged, clashes: [{ path, label, mine, theirs }] }.
const J = x => JSON.stringify(x ?? null);
const same = (a, b) => J(a) === J(b);

function pick(base, mine, theirs, path, label, clashes) {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  clashes.push({ path, label, mine, theirs });
  return mine;
}
// lists of objects with a key (id, date): merge item by item; one side adding or deleting wins over no change
function byKey(base = [], mine = [], theirs = [], key, path, label, clashes, inner) {
  const B = new Map(base.map(x => [x[key], x])), M = new Map(mine.map(x => [x[key], x])), T = new Map(theirs.map(x => [x[key], x]));
  const keys = [...new Set([...mine.map(x => x[key]), ...theirs.map(x => x[key])])];
  const out = [];
  for (const k of keys) {
    const b = B.get(k), m = M.get(k), t = T.get(k);
    if (m && t) out.push(inner ? inner(b, m, t, `${path}.${k}`) : pick(b, m, t, `${path}.${k}`, label(m, k), clashes));
    else if (m && !t) { if (!b || !same(b, m)) out.push(m); }          // theirs deleted it: keep only if I changed it
    else if (t && !m) { if (!b || !same(b, t)) out.push(t); }
  }
  return out;
}
// plain lists (labs): keep what either side added, drop what either side removed (unless the other changed it)
function bag(base = [], mine = [], theirs = []) {
  const k = J, bs = new Set(base.map(k)), ms = new Set(mine.map(k)), ts = new Set(theirs.map(k));
  const out = [], seen = new Set();
  for (const x of [...mine, ...theirs]) {
    const s = k(x); if (seen.has(s)) continue; seen.add(s);
    const inM = ms.has(s), inT = ts.has(s), inB = bs.has(s);
    if (inM && inT) out.push(x); else if (!inB) out.push(x);          // added by one side
  }
  return out;
}
// per-date maps (vitals, bill, seen, times)
function byDate(base = {}, mine = {}, theirs = {}, path, label, clashes) {
  const out = {};
  for (const d of new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})])) {
    const v = pick(base?.[d], mine?.[d], theirs?.[d], `${path}.${d}`, label(d), clashes);
    if (v !== undefined && v !== null) out[d] = v;
  }
  return out;
}

export function mergePatient(base, mine, theirs) {
  const clashes = [];
  if (!base) base = {};
  const out = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    if (k === "rev" || k === "updated") continue;
    if (k === "problems") {
      out.problems = byKey(base.problems, mine.problems, theirs.problems, "id", "problems", null, clashes, (b, m, t, path) => {
        b ||= {};
        const p = {};
        for (const f of new Set([...Object.keys(m), ...Object.keys(t)])) {
          if (f === "hpi" || f === "plan") p[f] = byKey(b[f], m[f], t[f], "date", `${path}.${f}`,
            (e, d) => `${m.name}: ${f === "hpi" ? "HPI" : "Plan"} ${d.slice(5).replace("-", "/").replace(/^0/, "")}`, clashes);
          else if (f === "meds") p.meds = byKey(b.meds, m.meds, t.meds, "id", `${path}.meds`, x => `${m.name}: ${x.name || "a medication"}`, clashes);
          else { const v = pick(b[f], m[f], t[f], `${path}.${f}`, `${m.name}: ${f === "planOpen" ? "first plan line" : f === "hpiOpen" ? "first HPI line" : f}`, clashes); if (v !== undefined) p[f] = v; }
        }
        return p;
      });
    } else if (k === "labs") out.labs = bag(base.labs, mine.labs, theirs.labs);
    else if (k === "notes") out.notes = byKey(base.notes, mine.notes, theirs.notes, "id", "notes", x => `Note: ${String(x.text || "").slice(0, 40)}`, clashes);
    else if (k === "log") { const seen = new Set(); out.log = [...(mine.log || []), ...(theirs.log || [])].filter(x => { const s = J(x); if (seen.has(s)) return false; seen.add(s); return true; }).sort((a, b) => a.at - b.at); }
    else if (["vitals", "bill", "seen", "times", "addressed"].includes(k)) out[k] = byDate(base[k], mine[k], theirs[k], k, d => `${k === "bill" ? "Billing" : k[0].toUpperCase() + k.slice(1)} ${d.slice(5).replace("-", "/")}`, clashes);
    else if (k === "pendingLabs" || k === "refusing") out[k] = bag(base[k], mine[k], theirs[k]);
    else { const v = pick(base[k], mine[k], theirs[k], k, k, clashes); if (v !== undefined) out[k] = v; }
  }
  return { merged: out, clashes };
}
// put the other side's value at a clash's path (used when the person picks "theirs")
export function applyTheirs(rec, clash) {
  const parts = clash.path.split(".");
  let cur = rec;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i], next = cur[seg];
    if (Array.isArray(next)) { const key = parts[i + 1], idx = next.findIndex(x => x.id === key || x.date === key);
      if (i + 1 === parts.length - 1) { if (idx >= 0) next[idx] = clash.theirs; else next.push(clash.theirs); return rec; }
      cur = next[idx]; i++; }
    else cur = next ?? (cur[seg] = {});
  }
  cur[parts.at(-1)] = clash.theirs;
  return rec;
}
