import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { spawn } from "node:child_process";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 8765;
const FPL_API = "https://fantasy.premierleague.com/api";
const PL_IMG = "https://resources.premierleague.com/premierleague";
const DATA_FILE = join(ROOT, "data", "youtubers.json");
// Optional: raw GitHub URL for cron-updated data (falls back to local file).
const GITHUB_RAW = process.env.GITHUB_RAW || "";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res, urlPath) {
  let p = normalize(join(ROOT, decodeURIComponent(urlPath)));
  try {
    const s = await stat(p);
    if (s.isDirectory()) p = join(p, "index.html");
    const data = await readFile(p);
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`404 not found: ${urlPath}`);
  }
}

function proxyFpl(req, res, apiPath) {
  const upstream = `${FPL_API}${apiPath}${req.url.includes("?") ? "?" + req.url.split("?")[1] : ""}`;
  https
    .get(upstream, { headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      "Accept": "application/json",
      "Referer": "https://fantasy.premierleague.com/",
    } }, (up) => {
      res.writeHead(up.statusCode || 502, {
        "Content-Type": up.headers["content-type"] || "application/json",
        "Cache-Control": "no-store",
      });
      up.pipe(res);
    })
    .on("error", (e) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    });
}

const imgCache = new Map(); // path -> { buf, type, ts }

function proxyImg(req, res, imgPath) {
  const hit = imgCache.get(imgPath);
  if (hit && Date.now() - hit.ts < 3600000) {
    res.writeHead(200, {
      "Content-Type": hit.type,
      "Cache-Control": "public, max-age=86400",
    });
    res.end(hit.buf);
    return;
  }
  const upstream = `${PL_IMG}${imgPath}`;
  https
    .get(upstream, { headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      "Accept": "image/*,*/*;q=0.8",
      "Referer": "https://fantasy.premierleague.com/",
    } }, (up) => {
      if (up.statusCode !== 200) {
        // Upstream refused (403/404) — serve stale if we have it, else pass through.
        if (hit) {
          res.writeHead(200, { "Content-Type": hit.type, "Cache-Control": "public, max-age=86400" });
          res.end(hit.buf);
          return;
        }
        res.writeHead(up.statusCode || 502, { "Content-Type": "text/plain" });
        res.end("img proxy error");
        return;
      }
      const chunks = [];
      up.on("data", (c) => chunks.push(c));
      up.on("end", () => {
        const buf = Buffer.concat(chunks);
        imgCache.set(imgPath, {
          buf,
          type: up.headers["content-type"] || "image/jpeg",
          ts: Date.now(),
        });
        if (imgCache.size > 2000) {
          const oldest = imgCache.keys().next().value;
          imgCache.delete(oldest);
        }
        res.writeHead(200, {
          "Content-Type": up.headers["content-type"] || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(buf);
      });
    })
    .on("error", () => {
      if (hit) {
        res.writeHead(200, { "Content-Type": hit.type, "Cache-Control": "public, max-age=86400" });
        res.end(hit.buf);
        return;
      }
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("img proxy error");
    });
}

// ── YouTuber data ──────────────────────────────────────────
let ytCache = { data: null, ts: 0 };
let ytRefreshing = false;

async function readYt() {
  if (ytCache.data && Date.now() - ytCache.ts < 90000) return ytCache.data;
  if (GITHUB_RAW) {
    try {
      const res = await fetch(GITHUB_RAW, { headers: { "User-Agent": "liamapp" } });
      if (res.ok) {
        const data = await res.json();
        ytCache = { data, ts: Date.now() };
        return data;
      }
    } catch {
      // fall back to local file
    }
  }
  try {
    const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
    ytCache = { data, ts: Date.now() };
    return data;
  } catch {
    return { channels: [], focalBuy: [], overrides: {}, updatedAt: null };
  }
}

function saveYt(data) {
  return writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function handleYtApi(req, res, path) {
  if (path === "/api/youtubers" && req.method === "GET") {
    const data = await readYt();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
    return;
  }
  if (path === "/api/youtubers/edit" && req.method === "POST") {
    try {
      const patch = await readBody(req);
      const data = await readYt();
      const channel = (data.channels || []).find((c) => c.id === patch.channelId);
      if (!channel) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "channel not found" }));
        return;
      }
      const overrides = data.overrides || {};
      const ov = overrides[patch.channelId] || {};
      if (patch.videoId != null) ov.videoId = patch.videoId;
      if (patch.players != null) ov.players = patch.players;
      if (patch.captain != null) ov.captain = patch.captain;
      if (patch.notes != null) ov.notes = patch.notes;
      overrides[patch.channelId] = ov;
      data.overrides = overrides;
      // apply to the live team object so the UI updates immediately
      if (channel.team) {
        channel.team.status = "edited";
        if (ov.players) channel.team.players = ov.players;
        if (ov.captain) channel.team.captain = ov.captain;
        if (ov.notes) channel.team.notes = ov.notes;
      }
      await saveYt(data);
      ytCache = { data, ts: Date.now() };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  if (path === "/api/youtubers/refresh" && req.method === "POST") {
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, running: ytRefreshing }));
    if (!ytRefreshing) {
      ytRefreshing = true;
      const child = spawn("node", ["scripts/yt.mjs"], {
        cwd: ROOT,
        detached: true,
        stdio: "ignore",
      });
      child.on("exit", () => {
        ytRefreshing = false;
        ytCache = { data: null, ts: 0 };
      });
      child.on("error", () => {
        ytRefreshing = false;
      });
    }
    return;
  }
}

createServer((req, res) => {
  const url = req.url || "/";
  const path = url.split("?")[0];
  if (path.startsWith("/api/youtubers")) handleYtApi(req, res, path);
  else if (url.startsWith("/fpl-api/")) proxyFpl(req, res, "/" + url.slice("/fpl-api/".length));
  else if (url.startsWith("/pl-img/")) proxyImg(req, res, "/" + url.slice("/pl-img/".length));
  else serveStatic(req, res, url === "/" ? "/index.html" : url);
}).listen(PORT, () => console.log(`liam app on http://localhost:${PORT}`));