// Shared DOM helpers + formatting utilities.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let lateValue;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") lateValue = v;
    else if (["checked", "selected", "disabled", "readonly", "multiple"].includes(k))
      el[k] = !!v;
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v === false) {}
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    if (typeof kid === "string" || typeof kid === "number" || typeof kid === "bigint")
      el.appendChild(document.createTextNode(String(kid)));
    else el.appendChild(kid);
  }
  if (lateValue !== undefined) el.value = lateValue;
  return el;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function money(n) { return `£${(Math.round((n || 0) * 10) / 10).toFixed(1)}`; }
export function fmt(n, d = 1) { return ((n || 0).toFixed(d)); }
export function pct(n) { return `${(Math.round((n || 0) * 10) / 10).toFixed(1)}%`; }
export function int(n) { return Math.round(n || 0).toLocaleString(); }

export const POS_SHORT = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
export const POS_NAME = { 1: "Goalkeeper", 2: "Defender", 3: "Midfielder", 4: "Forward" };

export const TEAM_COLORS = {
  ARS: "#EF0107", AVL: "#7A003C", BOU: "#C8102E", BRE: "#E30613",
  BHA: "#0057B8", CHE: "#034694", COV: "#87B1E0", CRY: "#1B458F",
  EVE: "#003399", FUL: "#1A1A1A", HUL: "#F5A414", IPS: "#3A64A3",
  LEE: "#FFD500", LIV: "#C8102E", MCI: "#6CABDD", MUN: "#DA291C",
  NEW: "#2B2B2B", NFO: "#DD0000", TOT: "#132257", SUN: "#EB172B",
};

export function hexToRgb(hx) {
  const n = parseInt(hx.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function contrastText(bg) {
  if (!bg || bg[0] !== "#" || bg.length < 7) return "#fff";
  const { r, g, b } = hexToRgb(bg);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? "#131313" : "#ffffff";
}

export function initials(name) {
  const parts = (name || "").replace(/[^\p{L}\s'-]/gu, "").trim().split(/\s+/);
  if (!parts.length || !parts[0]) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function crestUrl(team) {
  if (!team?.code) return "";
  return `https://resources.premierleague.com/premierleague/badges/50/t${team.code}.png`;
}

export function photoUrl(player, size = "110x110") {
  if (!player?.photo) return "";
  return `/pl-img/photos/players/${size}/${player.photo}`;
}

export function teamColor(team) {
  return (team && TEAM_COLORS[team.short_name]) || "#2a3a5e";
}

// Fixture Difficulty Rating colour scale (1 = easy green -> 5 = hard red).
export function fdrColor(n) {
  const map = { 1: "#2fd35f", 2: "#8fe35a", 3: "#f6d545", 4: "#f59c3d", 5: "#f0483e" };
  return map[n] || "#8a8a8a";
}

export function fdrClass(n) {
  return `fdr-${n || 3}`;
}

// Photos that 403'd/404'd are never requested again this session
// (avoids console spam from missing/blocked player images).
const BROKEN_PHOTOS = new Set();

export function avatar(player, team, opts = {}) {
  const color = teamColor(team);
  const txt = contrastText(color);
  const size = opts.size === "sm" ? "av av--sm" : opts.size === "lg" ? "av av--lg" : "av";
  const wrap = h("div", { class: size, style: `background:${color};color:${txt}` }, initials(player.name));
  if (player.photo && !BROKEN_PHOTOS.has(player.photo)) {
    const img = h("img", { src: photoUrl(player), alt: player.name });
    img.addEventListener("error", () => {
      BROKEN_PHOTOS.add(player.photo);
      img.remove();
    });
    wrap.insertBefore(img, wrap.firstChild);
  }
  return wrap;
}

export function fdrBadge(n, title) {
  return h("span", {
    class: `fdr-badge ${fdrClass(n)}`,
    title: title || `FDR ${n}`,
  }, String(n));
}

export function statusInfo(code) {
  const map = {
    a: { label: "Available", kind: "ok" },
    d: { label: "Doubt", kind: "warn" },
    i: { label: "Injured", kind: "bad" },
    s: { label: "Suspended", kind: "bad" },
    u: { label: "Unavailable", kind: "bad" },
    n: { label: "Not in squad", kind: "warn" },
  };
  return map[code] || { label: code || "?", kind: "unknown" };
}

export function statusDot(code) {
  const st = statusInfo(code);
  return h("span", { class: `dot dot--${st.kind}`, title: st.label });
}

export function sparkline(points, { height = 30, color } = {}) {
  if (!points || !points.length) return h("span", { class: "muted" }, "—");
  const max = Math.max(...points, 0.1);
  const w = Math.max(2, points.length * 12);
  const step = points.length > 1 ? (w - 2) / (points.length - 1) : w;
  let d = "";
  points.forEach((p, i) => {
    const x = 1 + i * step;
    const y = height - 2 - (p / max) * (height - 4);
    d += (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${w} ${height}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", color || "var(--accent)");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

export function bar(value, max, { warn = false, color } = {}) {
  const v = max > 0 ? Math.min(1, value / max) : 0;
  const c = color || (warn ? "var(--warn)" : "var(--accent)");
  return h("span", { class: "bar" }, h("i", { style: `width:${(v * 100).toFixed(1)}%;background:${c}` }));
}
