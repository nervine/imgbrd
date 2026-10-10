import { CapacitorHttp } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { createApi } from "../../shared/engine.js";
import { BOARD_TYPES, BOARDS, findBoard, publicBoard } from "../../server/boards.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 imgbrd/1.0";

class BoardError extends Error {
  constructor(message, status = 400, vars = null) {
    super(message);
    this.status = status;
    this.vars = vars;
  }
}

function isPrivateHost(host) {
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return host === "::1" || host === "::";
  const [a, b] = ipv4.slice(1).map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BoardError("invalidUrl");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BoardError("badProtocol");
  }
  if (url.username || url.password) throw new BoardError("embeddedLogin");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new BoardError("localAddress");
  }
  if (isPrivateHost(host)) throw new BoardError("privateAddress");
  return url;
}

function absoluteUrl(base, value) {
  if (!value) return "";
  try {
    return new URL(value, base.endsWith("/") ? base : `${base}/`).href;
  } catch {
    return "";
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function splitTags(value) {
  return decodeHtml(value).split(/\s+/).map((tag) => tag.trim()).filter(Boolean);
}

function mediaKind(url) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (/\.(webm|mp4|m4v)$/.test(path)) return "video";
  return "image";
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pageUrl(board, id) {
  const base = board.baseUrl.replace(/\/$/, "");
  if (board.type === "shimmie") return `${base}/post/view/${id}`;
  if (board.type === "danbooru") return `${base}/posts/${id}`;
  return `${base}/index.php?page=post&s=view&id=${id}`;
}

function asText(data) {
  if (typeof data === "string") return data;
  if (data == null) return "";
  return JSON.stringify(data);
}

async function fetchText(url, referer) {
  await assertPublicHttpUrl(url);
  const response = await CapacitorHttp.get({
    url,
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": UA,
      ...(referer ? { Referer: referer } : {}),
    },
    responseType: "text",
    connectTimeout: 20000,
    readTimeout: 20000,
  });
  return {
    response: {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
    },
    text: asText(response.data),
  };
}

async function sealUrl(url) {
  if (!url) return "";
  try {
    await assertPublicHttpUrl(url);
  } catch {
    return "";
  }
  return url;
}

const api = createApi({
  BoardError,
  absoluteUrl,
  assertPublicHttpUrl,
  decodeHtml,
  fetchText,
  mediaKind,
  mulberry32,
  pageUrl,
  sealUrl,
  splitTags,
  findBoard,
  BOARD_TYPES,
});

export function nativeBoards() {
  return BOARDS.map(publicBoard);
}

export async function nativePost(url, body) {
  try {
    if (url.endsWith("/api/posts")) return await api.getPosts(body);
    if (url.endsWith("/api/suggest")) return { tags: await api.suggestTags(body) };
    if (url.endsWith("/api/resolve")) return await api.resolveOriginal(body);
    return { error: "unknownRequest", posts: [], hasMore: false, note: "" };
  } catch (error) {
    if (url.endsWith("/api/suggest")) return { tags: [] };
    if (url.endsWith("/api/resolve")) return { error: error.message || "originalNotFound", vars: error.vars || null };
    return { error: error.message || "queryFailed", vars: error.vars || null, posts: [], hasMore: false, note: "" };
  }
}

function contentType(url, header) {
  const clean = String(header || "").split(";")[0].trim().toLowerCase();
  if (clean.startsWith("image/") || clean.startsWith("video/")) return clean;
  const path = String(url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "video/mp4";
  return "application/octet-stream";
}

function bytesFrom(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer);
  if (typeof data === "string") {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array();
}

export async function loadMediaObjectUrl(url, referer) {
  let origin = referer;
  try {
    origin = new URL(referer || url).origin;
  } catch {
    origin = undefined;
  }
  const response = await CapacitorHttp.get({
    url,
    headers: {
      Accept: "image/avif,image/webp,image/*,video/*,*/*;q=0.8",
      "User-Agent": UA,
      ...(origin ? { Referer: origin } : {}),
    },
    responseType: "arraybuffer",
    connectTimeout: 20000,
    readTimeout: 60000,
  });
  if (response.status < 200 || response.status >= 300) return "";
  const header = response.headers?.["Content-Type"] || response.headers?.["content-type"] || "";
  const blob = new Blob([bytesFrom(response.data)], { type: contentType(url, header) });
  return URL.createObjectURL(blob);
}

export async function exportJson(json, labels = {}) {
  const written = await Filesystem.writeFile({
    path: "imgbrd-sicherung.json",
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title: labels.title || "imgbrd backup",
    files: [written.uri],
    dialogTitle: labels.dialog || "Save or share backup",
  });
}
