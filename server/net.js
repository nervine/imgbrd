import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 imgbrd/1.0";

const secret = crypto.randomBytes(32);
const dnsCache = new Map();

export class BoardError extends Error {
  constructor(message, status = 400, vars = null) {
    super(message);
    this.status = status;
    this.vars = vars;
  }
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const value = ip.toLowerCase();
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
    if (value.startsWith("::ffff:")) return isPrivateIp(value.slice(7));
    return false;
  }
  return true;
}

export async function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BoardError("invalidUrl");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BoardError("badProtocol");
  }
  if (url.username || url.password) {
    throw new BoardError("embeddedLogin");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new BoardError("localAddress");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new BoardError("privateAddress");
    return url;
  }

  const now = Date.now();
  const cached = dnsCache.get(host);
  let addresses = cached && now - cached.at < 10 * 60 * 1000 ? cached.addresses : null;
  if (!addresses) {
    let records;
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new BoardError("hostNotFound", 502, { host });
    }
    addresses = records.map((record) => record.address);
    dnsCache.set(host, { addresses, at: now });
  }
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new BoardError("privateNetwork");
  }
  return url;
}

export function absoluteUrl(base, value) {
  if (!value) return "";
  try {
    return new URL(value, base.endsWith("/") ? base : `${base}/`).href;
  } catch {
    return "";
  }
}

export async function safeFetch(raw, { referer, accept, timeout = 20000 } = {}) {
  let current = raw;
  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublicHttpUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept: accept || "*/*",
        "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
        ...(referer ? { Referer: referer } : {}),
      },
      signal: AbortSignal.timeout(timeout),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new BoardError("redirectNoTarget", 502);
      current = new URL(location, current).href;
      continue;
    }
    return response;
  }
  throw new BoardError("tooManyRedirects", 502);
}

export async function fetchText(url, referer) {
  const response = await safeFetch(url, {
    referer,
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  });
  const text = await response.text();
  return { response, text };
}

export function seal(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `/api/media?t=${encodeURIComponent(`${body}.${sig}`)}`;
}

export function unseal(token) {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function sealUrl(url, referer) {
  if (!url) return "";
  try {
    await assertPublicHttpUrl(url);
  } catch {
    return "";
  }
  return seal({ url, referer });
}

export function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function splitTags(value) {
  return decodeHtml(value)
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function mediaKind(url) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (/\.(webm|mp4|m4v)$/.test(path)) return "video";
  return "image";
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pageUrl(board, id) {
  const base = board.baseUrl.replace(/\/$/, "");
  if (board.type === "shimmie") return `${base}/post/view/${id}`;
  if (board.type === "danbooru") return `${base}/posts/${id}`;
  return `${base}/index.php?page=post&s=view&id=${id}`;
}
