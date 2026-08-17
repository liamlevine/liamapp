// Apply curated teams (read from transcripts + on-screen pitch OCR) to
// data/youtubers.json. Manual curation wins over auto-extraction.
import { readFileSync, writeFileSync } from "node:fs";

const players = JSON.parse(readFileSync("data/players.json", "utf8")).players;
const store = JSON.parse(readFileSync("data/youtubers.json", "utf8"));

function find(web, team) {
  return players.find((p) => p.web === web && p.team === team)
    || players.find((p) => p.web === web);
}

function squad(spec, quote, captain) {
  return spec.map(([web, team, pos, bench]) => {
    const p = find(web, team);
    if (!p) throw new Error(`not found: ${web} ${team}`);
    return {
      pid: p.pid, name: p.web, pos: pos ?? p.pos, team: p.team,
      quote, conf: 1, bench: !!bench,
    };
  }).map((x) => ({ ...x, captain: x.pid === captain ? true : undefined }));
}

const focal = [
  ["Verbruggen", "BHA", 1], ["Kinsky", "TOT", 1, true],
  ["N.Williams", "NFO", 2], ["Maguire", "MUN", 2], ["Mosquera", "AVL", 2],
  ["Hume", "SUN", 2, true], ["O'Shea", "IPS", 2, true],
  ["Szoboszlai", "LIV", 3], ["Mbeumo", "MUN", 3], ["B.Fernandes", "MUN", 3],
  ["Ndiaye", "EVE", 3], ["Gomez", "BHA", 3, true],
  ["Haaland", "MCI", 4], ["João Pedro", "CHE", 4], ["Igor Jesus", "BRE", 4],
];

const harry = [
  ["Kinsky", "TOT", 1], ["Verbruggen", "BHA", 1, true],
  ["Vuskovic", "BHA", 2], ["Calafiori", "ARS", 2], ["Maguire", "MUN", 2],
  ["Rodon", "LEE", 2, true], ["Diop", "IPS", 2, true],
  ["Mbeumo", "MUN", 3], ["Wirtz", "LIV", 3], ["B.Fernandes", "MUN", 3],
  ["Groß", "BHA", 3], ["Sangaré", "NFO", 3, true],
  ["João Pedro", "CHE", 4], ["Calvert-Lewin", "LEE", 4], ["Haaland", "MCI", 4],
];

const raptor = [
  ["Verbruggen", "BHA", 1], ["Kinsky", "TOT", 1, true],
  ["Calafiori", "ARS", 2], ["Ballard", "SUN", 2], ["Maguire", "MUN", 2],
  ["Rodon", "LEE", 2, true], ["Davis", "IPS", 2, true],
  ["Tzolis", "ARS", 3], ["Hinshelwood", "BHA", 3], ["B.Fernandes", "MUN", 3],
  ["Mbeumo", "MUN", 3], ["Sangaré", "NFO", 3, true],
  ["João Pedro", "CHE", 4], ["Haaland", "MCI", 4], ["Calvert-Lewin", "LEE", 4],
];

const lets = [
  ["Kinsky", "TOT", 1], ["Verbruggen", "BHA", 1, true],
  ["Maguire", "MUN", 2], ["Mosquera", "ARS", 2], ["Calafiori", "ARS", 2],
  ["Hume", "SUN", 2, true], ["O'Shea", "IPS", 2, true],
  ["Mbeumo", "MUN", 3], ["Szoboszlai", "LIV", 3], ["Groß", "BHA", 3],
  ["B.Fernandes", "MUN", 3], ["Gomez", "BHA", 3, true],
  ["Haaland", "MCI", 4], ["João Pedro", "CHE", 4], ["Calvert-Lewin", "LEE", 4],
];

const CHANNELS = {
  "UC72QokPHXQ9r98ROfNZmaDw": { players: focal, captain: "Haaland", notes: "GW1 bench boost active. Bench: Kinsky, Hume, O'Shea, Gomez." },
  "UCcPWnCj5AKC19HaySZjb25g": { players: harry, captain: "Haaland", notes: "GW1 bench boost (75%). 3-4-3. Bench: Verbruggen, Rodon, Diop, Sangaré." },
  "UC54QLWzsMifTRjNQ02z5pCw": { players: raptor, captain: "Haaland", notes: "GW1 bench boost. Starting XI: Verbruggen; Calafiori, Ballard, Maguire; Tzolis, Hinshelwood, B.Fernandes, Mbeumo; João Pedro, Haaland, Calvert-Lewin." },
  "UCxeOc7eFxq37yW_Nc-69deA": { players: lets, captain: "Haaland", notes: "GW1 bench boost, 3-4-3. Bench: Verbruggen, Hume, O'Shea, Gomez." },
};

const capPid = (spec, name) => {
  const p = find(name);
  return p ? p.pid : null;
};

store.overrides = store.overrides || {};
for (const ch of store.channels || []) {
  const c = CHANNELS[ch.id];
  if (!c) continue;
  const ps = squad(c.players, "Curated from the video (screen + transcript).");
  const cap = capPid(c.players, c.captain);
  store.overrides[ch.id] = {
    players: ps.map((p) => ({ pid: p.pid, name: p.name, pos: p.pos, team: p.team, quote: p.quote, conf: 1, bench: p.bench || false })),
    captain: cap,
    notes: c.notes,
  };
  if (ch.team) {
    ch.team.status = "edited";
    ch.team.players = ps.map((p) => ({ pid: p.pid, name: p.name, pos: p.pos, team: p.team, quote: p.quote, conf: 1, bench: p.bench || false }));
    ch.team.captain = cap;
    ch.team.notes = c.notes;
  }
}
store.curatedAt = new Date().toISOString();
writeFileSync("data/youtubers.json", JSON.stringify(store, null, 2));
console.log("teams written:");
for (const ch of store.channels) {
  console.log(`${ch.name}: ${ch.team.players.length} players, captain ${ch.team.captain} (${ch.team.players.find((p) => p.pid === ch.team.captain)?.name}), bench: ${ch.team.players.filter((p) => p.bench).map((p) => p.name).join(", ")}`);
}
