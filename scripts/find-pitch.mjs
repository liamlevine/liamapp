// Find the pitch frames in a per-frame OCR dump and print the best ones.
// Usage: node scripts/find-pitch.mjs <ocr.txt>
import { readFileSync } from "node:fs";

const players = JSON.parse(readFileSync("data/players.json", "utf8")).players;
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, " ");
const short = (s) => norm(s).replace(/\./g, " ").trim().replace(/\s+/g, " ");
const fuzzy = (s) => short(s).replace(/[aeiou]/g, "");
const lookup = new Map();
for (const p of players) {
  lookup.set(short(p.web), p);
  lookup.set(short(p.last), p);
  lookup.set(fuzzy(p.web), p);
  lookup.set(fuzzy(p.last), p);
}

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const frames = new Map();
for (const line of lines) {
  const [frame, xy, text] = line.split("\t");
  if (!xy || !text) continue;
  const [x, y] = xy.split(",").map(Number);
  const t = text.trim();
  if (t.length < 3) continue;
  const band = y > 0.75 ? "GK" : y > 0.55 ? "DEF" : y > 0.33 ? "MID" : y > 0.15 ? "FWD" : "BENCH";
  const p = lookup.get(short(t)) || (fuzzy(t).length >= 4 ? lookup.get(fuzzy(t)) : null);
  if (!p) continue;
  if (!frames.has(frame)) frames.set(frame, new Map());
  const m = frames.get(frame);
  const key = `${band}:${p.pid}`;
  if (!m.has(key)) m.set(key, { p, band, n: 0 });
  m.get(key).n++;
}

// score = distinct confident players, formation sanity
const scored = [];
for (const [frame, m] of frames) {
  const conf = [...m.values()].filter((v) => v.n >= 1);
  const byPid = new Map();
  for (const v of conf) {
    if (!byPid.has(v.p.pid)) byPid.set(v.p.pid, v);
  }
  const uniq = [...byPid.values()];
  const bands = {};
  for (const v of uniq) bands[v.band] = (bands[v.band] || 0) + 1;
  const outfield = (bands.DEF || 0) + (bands.MID || 0) + (bands.FWD || 0);
  const pitchLike = outfield >= 7 && (bands.GK || 0) >= 1;
  const score = uniq.length + (pitchLike ? 10 : 0);
  if (uniq.length >= 6) scored.push({ frame, score, bands, conf: uniq });
}
scored.sort((a, b) => b.score - a.score);
for (const s of scored.slice(0, 8)) {
  console.log(`${s.frame} score=${s.score} ${JSON.stringify(s.bands)}`);
  for (const v of s.conf.slice(0, 16)) console.log(`   ${v.band} ${v.p.web} (${v.p.team}) x${v.n}`);
}
