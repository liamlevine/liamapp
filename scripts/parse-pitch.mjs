// Parse a coordinate-OCR dump into an FPL pitch team.
// Usage: node scripts/parse-pitch.mjs <ocr.txt> [out.json]
// OCR line format: "x,y,w,h\tTEXT"  (Vision coords, y measured from bottom)
import { readFileSync, writeFileSync } from "node:fs";

const players = JSON.parse(readFileSync("data/players.json", "utf8")).players;

function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, " ");
}
function short(s) { // "B.Fernandes" -> "b fernandes", "O'Shea" -> "o shea"
  return norm(s).replace(/\./g, " ").trim().replace(/\s+/g, " ");
}
function fuzzy(s) { // drop vowels for OCR-typo matching
  return short(s).replace(/[aeiou]/g, "");
}

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const bands = { GK: [], DEF: [], MID: [], FWD: [], BENCH: [] };
let maxT = 0; // not needed for single-file parse; frames have t in text? no

for (const line of lines) {
  const [xy, text] = line.split("\t");
  if (!xy || !text) continue;
  const [x, y] = xy.split(",").map(Number);
  const t = text.trim();
  if (t.length < 3 || !/[a-z]/i.test(t)) continue;
  const band = y > 0.75 ? "GK" : y > 0.55 ? "DEF" : y > 0.33 ? "MID" : y > 0.15 ? "FWD" : "BENCH";
  bands[band].push({ x, t });
}

const lookup = new Map();
for (const p of players) {
  lookup.set(short(p.web), p);
  lookup.set(short(p.last), p);
  lookup.set(fuzzy(p.web), p);
  lookup.set(fuzzy(p.last), p);
}

function matchName(t) {
  const k = short(t);
  if (lookup.has(k)) return lookup.get(k);
  const f = fuzzy(t);
  if (f.length >= 4 && lookup.has(f)) return lookup.get(f);
  // last-token match (e.g. "Pedro" from "JOAO PEDRO")
  if (lookup.has(k)) return lookup.get(k);
  return null;
}

const out = { GK: [], DEF: [], MID: [], FWD: [], BENCH: [] };
const seen = new Set();
for (const [band, toks] of Object.entries(bands)) {
  const counts = new Map();
  for (const { x, t } of toks) {
    const p = matchName(t);
    if (p) {
      const key = `${band}:${p.pid}`;
      if (!counts.has(key)) counts.set(key, { p, n: 0, x: [] });
      const c = counts.get(key);
      c.n++;
      c.x.push(x);
    }
  }
  for (const c of counts.values()) {
    c.x.sort((a, b) => a - b);
    c.mx = c.x[Math.floor(c.x.length / 2)];
  }
  out[band].push(
    ...[...counts.values()]
      .filter((c) => c.n >= 2)
      .sort((a, b) => a.mx - b.mx),
  );
  for (const c of out[band]) seen.add(c.p.pid);
}

const result = {};
for (const band of ["GK", "DEF", "MID", "FWD", "BENCH"]) {
  result[band] = out[band].map((c) => `${c.p.web} (${c.p.team}, ${c.p.pid}) x${c.mx.toFixed(2)} n${c.n}`);
  console.log(band + ":", result[band].join(" | ") || "(none)");
}
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
