// FPL YouTuber tracker — 100% free, no API keys, no tokens.
//
// Every run:
//   1. Fetches each channel's RSS feed (key-free) for new videos.
//   2. Fetches transcripts for team-reveal / players-to-buy videos,
//      preferring manual captions (en-GB) over auto ones — auto captions
//      mangle player names. Quality is scored by name-hit count.
//   3. Heuristically extracts the squad (2 GK / 5 DEF / 5 MID / 3 FWD)
//      and, for FPL Focal's Monday "Players to Buy" videos, his weekly
//      expected points (0.5–9) and opening-5 totals (9.1–35).
//   4. Merges with the existing data/youtubers.json, preserving any
//      manual overrides made in the app.
//
// Runs locally (node scripts/yt.mjs) or via the GitHub Action cron.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { YoutubeTranscript } from "youtube-transcript";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, "data");
const FILE = join(DATA_DIR, "youtubers.json");
const PLAYERS_FILE = join(DATA_DIR, "players.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const FPL_API = "https://fantasy.premierleague.com/api/bootstrap-static/";

const CHANNELS = [
  { name: "FPL Focal", handle: "@FPLFocal", id: "UC72QokPHXQ9r98ROfNZmaDw" },
  { name: "FPL Harry", handle: "@FPLHarry", id: "UCcPWnCj5AKC19HaySZjb25g" },
  { name: "FPL Raptor", handle: "@FPLRaptor", id: "UC54QLWzsMifTRjNQ02z5pCw" },
  { name: "Lets Talk FPL", handle: "@LetsTalkFPL", id: "UCxeOc7eFxq37yW_Nc-69deA" },
];

const CAPS = { 1: 2, 2: 5, 3: 5, 4: 3 };

// A title is a team reveal if it says "team reveal" etc. or starts with "my …"
// — deliberately NOT matching "rating/reviewing/champion/template" videos,
// interviews ("with @") or anything about other people's teams.
const REVEAL_RE =
  /team reveal|final team|squad reveal|team selection|my [^|\n]{0,60}\b(team|draft|squad)\b/i;
const NOT_OWN_REVEAL_RE =
  /rating|reviewing|champions|champion|best teams|template|players to buy|watchlist|shortlist|options|drafts ranked|interview|with @|overlook/i;
const BUY_RE = /players to buy|to buy/i;

const POS_WORDS = {
  captain: 3, "vice captain": 1.5, vice: 1.2, team: 1.2, my: 0.6, have: 0.6,
  got: 0.6, picked: 1, selected: 1, starting: 1, lock: 1.5, locked: 1.5,
  final: 1.2, going: 0.6, keeping: 1, "in my": 1.5, bench: 0,
};
const NEG_WORDS = {
  "draft one": -3, "draft two": -3, "draft three": -3, "first draft": -3,
  alternative: -3, alternatively: -3, maybe: -1.5, could: -1, consider: -1.5,
  instead: -2, option: -1.5, options: -1.5, vs: -2, against: -1,
  fixture: -1, interview: -3, question: -1.5, watchlist: -3, shortlist: -3,
  "if you": -1.5, "one to watch": -3, watching: -1.5, "wait and see": -2,
};

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
}

async function fetchRss(channelId) {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`rss ${res.status}`);
  const xml = await res.text();
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    if (id) entries.push({ id, title, publishedAt: published });
  }
  return entries;
}

async function transcript(videoId) {
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId);
    return segs
      .map((s) => ({ t: parseFloat(s.offset) || 0, s: String(s.text || "").trim() }))
      .filter((s) => s.s.length);
  } catch {
    return null;
  }
}

async function bestTranscript(videoId, players) {
  // Manual captions have correct names; auto (asr) mangles them.
  // Fetch candidate tracks and keep the one that matches the most players.
  const match = makeMatcher(players);
  const candidates = [];
  for (const lang of ["en-GB", "en", "en-US"]) {
    try {
      const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      const clean = segs
        .map((s) => ({ t: parseFloat(s.offset) || 0, s: String(s.text || "").trim() }))
        .filter((s) => s.s.length);
      if (clean.length >= 20) {
        const hits = clean.reduce((a, seg) => a + match(seg.s).size, 0);
        candidates.push({ lang, segs: clean, hits });
      }
    } catch {
      // track missing
    }
  }
  candidates.sort((a, b) => b.hits - a.hits);
  return candidates[0]?.segs || null;
}

async function loadPlayers() {
  if (existsSync(PLAYERS_FILE)) {
    const cached = JSON.parse(readFileSync(PLAYERS_FILE, "utf8"));
    if (Date.now() - cached.updatedAt < 24 * 3600 * 1000) return cached.players;
  }
  const res = await fetch(FPL_API, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const boot = await res.json();
  const teamName = Object.fromEntries(boot.teams.map((t) => [t.id, t.short_name]));
  const players = boot.elements.map((e) => ({
    pid: e.id,
    web: e.web_name,
    full: `${e.first_name} ${e.second_name}`,
    last: e.second_name,
    pos: e.element_type,
    team: teamName[e.team] || "?",
    sel: e.selected_by_percent || 0,
    now: e.now_cost || 0,
  }));
  writeFileSync(PLAYERS_FILE, JSON.stringify({ updatedAt: Date.now(), players }));
  return players;
}

function makeMatcher(players) {
  const byToken = new Map();
  const add = (token, p, kind) => {
    const k = norm(token).trim();
    if (k.length < 3) return;
    if (!byToken.has(k)) byToken.set(k, []);
    byToken.get(k).push({ p, kind });
  };
  const firstBest = new Map(); // first name -> most-likely player
  for (const p of players) {
    const first = norm(p.full.split(" ")[0]).trim();
    if (first.length >= 4 && norm(first) !== norm(p.web)) {
      const cur = firstBest.get(first);
      // "Bruno" in FPL talk almost always means the premium one —
      // prefer highest price, then highest selection.
      if (!cur || p.now > cur.now || (p.now === cur.now && p.sel > cur.sel)) firstBest.set(first, p);
    }
  }
  for (const p of players) {
    add(p.web, p, "web");
    if (norm(p.last).trim().length >= 3 && norm(p.last) !== norm(p.web)) add(p.last, p, "last");
    add(p.full, p, "full");
  }
  // "Bruno was on 6.7" — spoken first names map to the most-selected player.
  for (const [first, p] of firstBest) {
    const list = byToken.get(first) || [];
    if (!list.some((x) => x.kind === "web")) list.push({ p, kind: "first" });
    byToken.set(first, list);
  }
  return (text) => {
    const t = " " + norm(text) + " ";
    const hits = new Map();
    for (const [tok, list] of byToken) {
      if (!t.includes(" " + tok + " ")) continue;
      for (const { p, kind } of list) {
        const cur = hits.get(p.pid) || { w: 0, firstOnly: true };
        const w = kind === "web" ? 2 : kind === "full" ? 1.6 : kind === "first" ? 0.8 : 1;
        if (w > cur.w) {
          cur.w = w;
          cur.firstOnly = kind === "first";
        }
        hits.set(p.pid, cur);
      }
    }
    return hits;
  };
}

function segmentScore(text) {
  const t = " " + norm(text) + " ";
  let s = 0;
  for (const [w, v] of Object.entries(POS_WORDS)) {
    if (t.includes(" " + norm(w) + " ")) s += v;
  }
  for (const [w, v] of Object.entries(NEG_WORDS)) {
    if (t.includes(" " + norm(w) + " ")) s += v;
  }
  return s;
}

function extractTeam(segs, players) {
  const match = makeMatcher(players);
  const n = segs.length;
  const scores = new Map();
  segs.forEach((seg, i) => {
    const hits = match(seg.s);
    if (!hits.size) return;
    const ctx = segmentScore(seg.s);
    const posWeight = 0.4 + 0.6 * (i / Math.max(1, n - 1));
    const t = seg.s.toLowerCase();
    const bench = /\bbench\b/.test(t);
    // "captain" may land in the neighbouring segment
    const around = [seg.s, segs[i - 1]?.s || "", segs[i + 1]?.s || ""].join(" ").toLowerCase();
    const cap = /\bcaptain\b/.test(around);
    for (const [pid, hit] of hits) {
      const cur = scores.get(pid) || { score: 0, quote: "", quoteScore: -99, bench: false, cap: false };
      const s = (ctx + 0.4 * hit.w) * posWeight;
      cur.score += s;
      if (s > cur.quoteScore) {
        cur.quoteScore = s;
        cur.quote = seg.s.slice(0, 180);
      }
      if (bench) cur.bench = true;
      if (cap) cur.cap = true;
      scores.set(pid, cur);
    }
  });
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const [pid, v] of scores) {
    const p = players.find((x) => x.pid === pid);
    if (p) byPos[p.pos].push({ ...v, pid, p });
  }
  // Drop duplicates of the same spoken name (e.g. two "Sangaré"s) —
  // keep the highest-selected one.
  for (const pos of [1, 2, 3, 4]) {
    const seen = new Map();
    byPos[pos] = byPos[pos].filter((x) => {
      const k = norm(x.p.web);
      const cur = seen.get(k);
      if (cur && cur.p.sel >= x.p.sel) return false;
      seen.set(k, x);
      return true;
    });
  }
  const picked = [];
  let captainPid = null;
  for (const pos of [1, 2, 3, 4]) {
    byPos[pos].sort((a, b) => b.score - a.score);
    for (const cand of byPos[pos].slice(0, CAPS[pos])) {
      picked.push(cand);
      if (cand.cap && !captainPid) captainPid = cand.pid;
    }
  }
  if (!picked.length) return null;
  if (!captainPid) {
    const all = [...picked].sort((a, b) => b.score - a.score);
    captainPid = all[0]?.pid || null;
  }
  const maxScore = Math.max(...picked.map((x) => x.score));
  const conf = Math.min(0.95, Math.max(0.15, maxScore / 5));
  const playersOut = picked.map((x) => ({
    pid: x.pid,
    name: x.p.web,
    pos: x.p.pos,
    team: x.p.team,
    quote: x.quote,
    conf: Math.min(1, Math.round((x.score / maxScore) * 100) / 100),
    bench: x.bench,
  }));
  return { players: playersOut, captain: captainPid, conf: Math.round(conf * 100) / 100 };
}

// Focal's buy videos: numbers ≤9 next to "projected points/table/on N.N" are
// weekly expected points; numbers >9 are opening-5 totals. Prices (4.5m) and
// stats (xG/xGC) are filtered out.
function extractBuy(segs, players) {
  const match = makeMatcher(players);
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const n = segs.length;
  const acc = new Map();
  segs.forEach((seg, i) => {
    const hits = match(seg.s);
    if (!hits.size) return;
    const text = seg.s;
    const low = text.toLowerCase();
    const ctx = [seg.s, segs[i - 1]?.s || "", segs[i + 1]?.s || ""].join(" ").toLowerCase();
    const nums = [...text.matchAll(/(\d{1,2}\.\d)/g)]
      .map((x) => ({ v: parseFloat(x[1]), i: x.index, len: x[0].length }))
      .filter((x) => {
        if (x.v < 0.5 || x.v > 35) return false;
        // skip prices ("4.5m", "6.0m")
        const after = text.slice(x.i + x.len, x.i + x.len + 1);
        return after !== "m" && after !== "M";
      });
    const proj = /projected points|expected points|\btable\b|\bon \d/.test(low);
    const isStat = /xG|xGC|assists|goals conceded|prevented|expected goals/.test(ctx);
    const posWeight = 0.4 + 0.6 * (i / Math.max(1, n - 1));
    for (const [pid, hit] of hits) {
      const p = byPid.get(pid);
      if (!p) continue;
      const cur = acc.get(pid) || { score: 0, quote: "", qs: 0, xp: null, xp5: null };
      const s = (segmentScore(seg.s) + 0.4 * hit.w) * posWeight;
      cur.score += s;
      if (s > cur.qs) {
        cur.qs = s;
        cur.quote = text.slice(0, 180);
      }
      if (nums.length && proj && !isStat) {
        // attribute the number NEAREST to this player's name (±40 chars)
        let idx = -1;
        for (const tok of [p.web, p.last, p.full]) {
          const k = tok.toLowerCase();
          if (!k) continue;
          const j = low.indexOf(k);
          if (j >= 0 && (idx < 0 || j < idx)) idx = j;
        }
        if (idx < 0) {
          const first = norm(p.full.split(" ")[0]).trim();
          idx = low.indexOf(first);
        }
        if (idx >= 0) {
          const near = nums
            .map((x) => ({ x, d: Math.abs(x.i - idx) }))
            .filter((o) => o.d <= 40)
            .sort((a, b) => a.d - b.d)[0];
          if (near) {
            if (near.x.v <= 9 && cur.xp == null) {
              cur.xp = near.x.v;
              if (hit.firstOnly) cur.lowConf = true;
            } else if (near.x.v > 9 && cur.xp5 == null && !hit.firstOnly) {
              cur.xp5 = near.x.v;
            }
          }
        }
      }
      acc.set(pid, cur);
    }
  });
  const out = [];
  const seenNames = new Map();
  for (const [pid, v] of acc) {
    const p = players.find((x) => x.pid === pid);
    if (!p || (v.xp == null && v.xp5 == null)) continue;
    const k = norm(p.web);
    const cur = seenNames.get(k);
    if (cur && cur.sel >= p.sel) continue;
    seenNames.set(k, { sel: p.sel });
    out.push({ pid, name: p.web, pos: p.pos, team: p.team, xp: v.xp, xp5: v.xp5, lowConf: !!v.lowConf, quote: v.quote });
  }
  out.sort((a, b) => (b.xp ?? b.xp5 ?? 0) - (a.xp ?? a.xp5 ?? 0));
  return out.slice(0, 30);
}

function kindOf(title) {
  if (BUY_RE.test(title) && !REVEAL_RE.test(title)) return "buy";
  if (REVEAL_RE.test(title) && !NOT_OWN_REVEAL_RE.test(title)) return "reveal";
  return "other";
}

function loadStore() {
  if (existsSync(FILE)) {
    try {
      return JSON.parse(readFileSync(FILE, "utf8"));
    } catch {
      return { channels: [], focalBuy: [], overrides: {} };
    }
  }
  return { channels: [], focalBuy: [], overrides: {} };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  console.log("loading players index…");
  const players = await loadPlayers();
  console.log(`players: ${players.length}`);
  const store = loadStore();
  const byId = new Map(store.channels.map((c) => [c.id, c]));

  for (const ch of CHANNELS) {
    const prev = byId.get(ch.id) || {
      id: ch.id, name: ch.name, handle: ch.handle, videos: [], team: null,
    };
    let videos = prev.videos || [];
    let team = prev.team || null;
    try {
      const entries = await fetchRss(ch.id);
      console.log(`\n${ch.name}: ${entries.length} videos in feed`);
      const known = new Set(videos.map((v) => v.id));
      const fresh = entries.filter((e) => !known.has(e.id));
      for (const e of fresh.reverse()) {
        const kind = kindOf(e.title);
        const item = {
          id: e.id,
          title: e.title,
          publishedAt: e.publishedAt,
          kind,
          thumb: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${e.id}`,
          transcript: null,
        };
        if (kind !== "other") {
          const segs = await bestTranscript(e.id, players);
          item.transcript = !!segs;
          if (segs && kind === "reveal") {
            const ex = extractTeam(segs, players);
            if (ex) {
              item.extract = ex;
              console.log(`  TEAM ${e.title} -> ${ex.players.length} players (conf ${ex.conf})`);
              for (const pl of ex.players) console.log(`    ${pl.name} ${pl.team} [${pl.pos}] "${(pl.quote || "").slice(0, 70)}"`);
            }
          }
          if (segs && kind === "buy" && ch.name === "FPL Focal") {
            const gw = (e.title.match(/GW\s?(\d{1,2})/i) || [])[1] || "1";
            const buy = extractBuy(segs, players);
            item.buy = buy;
            console.log(`  BUY GW${gw}: ${buy.length} players`);
            for (const b of buy.slice(0, 10)) console.log(`    ${b.name} xP=${b.xp} xP5=${b.xp5} "${(b.quote || "").slice(0, 60)}"`);
            const list = store.focalBuy || [];
            const i = list.findIndex((x) => String(x.gw) === String(gw));
            const entry = { gw, videoId: e.id, title: e.title, publishedAt: e.publishedAt, players: buy };
            if (i >= 0) list[i] = entry;
            else list.push(entry);
            store.focalBuy = list.sort((a, b) => Number(b.gw) - Number(a.gw));
          }
        }
        videos.push(item);
        console.log(`  [${kind}] ${e.title}${item.transcript != null ? (item.transcript ? " (captions ✓)" : " (no captions)") : ""}`);
      }
      videos = videos.slice(-60);
    } catch (err) {
      console.log(`${ch.name} FAILED: ${err.message}`);
      console.log(err.stack?.split("\n").slice(0, 4).join("\n") || "");
    }
    // Pick the best team extraction: manual override video, else the reveal
    // video (last 14 days) with the most extracted players.
    const ov = (store.overrides || {})[ch.id] || {};
    const revealVideos = videos
      .filter((v) => v.extract && Date.now() - new Date(v.publishedAt).getTime() < 14 * 86400000)
      .sort(
        (a, b) =>
          b.extract.players.length * b.extract.conf - a.extract.players.length * a.extract.conf ||
          new Date(b.publishedAt) - new Date(a.publishedAt),
      );
    let chosen = revealVideos[0] || null;
    if (ov.videoId) {
      const forced = videos.find((v) => v.id === ov.videoId && v.extract);
      if (forced) chosen = forced;
    }
    team = chosen
      ? {
          videoId: chosen.id,
          title: chosen.title,
          publishedAt: chosen.publishedAt,
          players: chosen.extract.players,
          captain: chosen.extract.captain,
          conf: chosen.extract.conf,
          status: "auto",
        }
      : null;
    if (ov && team) {
      const overrideFresh = ov.publishedAt && new Date(ov.publishedAt).getTime() >= new Date(team.publishedAt).getTime();
      if (overrideFresh || (!ov.publishedAt && Array.isArray(ov.players) && ov.players.length)) {
        team.status = "edited";
        if (Array.isArray(ov.players) && ov.players.length) team.players = ov.players;
        if (ov.captain) team.captain = ov.captain;
        if (ov.notes) team.notes = ov.notes;
      }
    }
    byId.set(ch.id, {
      id: ch.id,
      name: ch.name,
      handle: ch.handle,
      videos,
      team,
      revealOptions: revealVideos.map((v) => ({
        id: v.id,
        title: v.title,
        publishedAt: v.publishedAt,
        players: v.extract.players.length,
        conf: v.extract.conf,
      })),
    });
  }

  store.channels = CHANNELS.map((c) => byId.get(c.id));
  store.updatedAt = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(store, null, 2));
  console.log(`\nwrote ${FILE}`);
}

main().catch((e) => {
  console.error("yt.mjs failed:", e);
  process.exit(1);
});
