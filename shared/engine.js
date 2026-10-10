export function createApi(deps) {
  const {
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
  } = deps;

const spanCache = new Map();

function cleanTags(tags) {
  return String(tags || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function withoutMeta(tags) {
  return cleanTags(tags)
    .split(" ")
    .filter((tag) => tag && !/^sort:/i.test(tag) && !/^order[:=]/i.test(tag) && !/^random:\d+$/i.test(tag))
    .join(" ");
}

function hasScoreClause(tags) {
  return /(^|\s)score[:=<>]/i.test(tags);
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeRating(value) {
  const rating = String(value || "").toLowerCase();
  if (rating === "g" || rating === "general" || rating === "safe" || rating === "s") return "safe";
  if (rating === "q" || rating === "questionable") return "questionable";
  if (rating === "e" || rating === "explicit") return "explicit";
  if (rating === "sensitive") return "sensitive";
  return rating || "unknown";
}

async function presentPost(board, post) {
  const referer = board.baseUrl;
  const fileUrl = post.fileUrl || "";
  const sampleUrl = post.sampleUrl || fileUrl;
  const previewUrl = post.previewUrl || sampleUrl || fileUrl;
  const [preview, sample, file] = await Promise.all([
    sealUrl(previewUrl, referer),
    sealUrl(sampleUrl, referer),
    sealUrl(fileUrl, referer),
  ]);
  return {
    id: String(post.id),
    score: post.score == null ? null : asNumber(post.score),
    rating: normalizeRating(post.rating),
    tags: post.tags || [],
    width: asNumber(post.width),
    height: asNumber(post.height),
    owner: post.owner || "",
    kind: mediaKind(fileUrl || sampleUrl || previewUrl),
    previewUrl: preview,
    sampleUrl: sample || file || preview,
    fileUrl: file || sample || preview,
    sampleWidth: sample && sample !== file ? asNumber(post.sampleWidth) : asNumber(post.width) || asNumber(post.sampleWidth),
    pageUrl: pageUrl(board, post.id),
    needsResolve: Boolean(post.needsResolve) && !file,
  };
}

async function sanitizeBoard(input, { allowCustom = false } = {}) {
  if (input?.boardId && !input?.board) {
    const builtin = findBoard(String(input.boardId));
    if (!builtin) throw new BoardError("unknownBoard");
    return builtin;
  }
  const source = input?.board && allowCustom ? input.board : null;
  if (!source) {
    const builtin = findBoard(String(input?.boardId || ""));
    if (!builtin) throw new BoardError("unknownBoard");
    return builtin;
  }
  const type = String(source.type || "");
  if (!BOARD_TYPES.includes(type)) throw new BoardError("unknownType");
  const name = String(source.name || "").trim().slice(0, 80);
  if (!name) throw new BoardError("boardNeedsName");
  const base = await assertPublicHttpUrl(String(source.baseUrl || ""));
  let apiBase = base.origin;
  if (source.apiBase) {
    const api = await assertPublicHttpUrl(String(source.apiBase));
    apiBase = api.origin;
  }
  return {
    id: String(source.id || "custom").slice(0, 80),
    name,
    type,
    baseUrl: base.origin,
    apiBase,
    needsAuth: Boolean(source.needsAuth),
    custom: true,
    pageSize: 20,
  };
}

function credentials(body) {
  const apiKey = String(body?.apiKey || "").trim().slice(0, 200);
  const userId = String(body?.userId || "").trim().slice(0, 120);
  return { apiKey, userId };
}

function readJsonPosts(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (/missing authentication/i.test(text)) {
      throw new BoardError("authMissing", 401);
    }
    if (/just a moment|cloudflare/i.test(text)) {
      throw new BoardError("cloudflare", 503);
    }
    throw new BoardError("unreadableList", 502);
  }
  if (Array.isArray(data)) return { posts: data, count: null };
  if (data && Array.isArray(data.post)) {
    return { posts: data.post, count: asNumber(data["@attributes"]?.count) || null };
  }
  if (data && data.post && typeof data.post === "object") {
    return { posts: [data.post], count: asNumber(data["@attributes"]?.count) || null };
  }
  if (data && Array.isArray(data.posts)) return { posts: data.posts, count: null };
  if (typeof data === "string") {
    throw new BoardError(data.slice(0, 240), 401);
  }
  return { posts: [], count: 0 };
}

async function gelbooru02(board, query) {
  const limit = 100;
  const tags = [withoutMeta(query.tags)];
  if (query.minScore > 0 && !hasScoreClause(query.tags)) tags.push(`score:>=${query.minScore}`);
  if (query.sort === "score") tags.push("sort:score:desc");
  if (query.sort === "random") tags.push(`sort:random:${query.seed % 10001}`);
  const endpoint = new URL("/index.php", board.apiBase || board.baseUrl);
  endpoint.searchParams.set("page", "dapi");
  endpoint.searchParams.set("s", "post");
  endpoint.searchParams.set("q", "index");
  endpoint.searchParams.set("json", "1");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("pid", String(query.page));
  const tagString = tags.filter(Boolean).join(" ");
  if (tagString) endpoint.searchParams.set("tags", tagString);
  if (query.apiKey && query.userId) {
    endpoint.searchParams.set("api_key", query.apiKey);
    endpoint.searchParams.set("user_id", query.userId);
  }
  const { response, text } = await fetchText(endpoint.href, board.baseUrl);
  if (response.status === 401 || response.status === 403) {
    if (/just a moment|cloudflare/i.test(text)) {
      throw new BoardError("cloudflare", 503);
    }
    throw new BoardError("accessDenied", 401);
  }
  const parsed = readJsonPosts(text);
  const posts = parsed.posts.map((post) => ({
    id: post.id,
    score: post.score,
    rating: post.rating,
    tags: splitTags(post.tags || post.tag_string || ""),
    width: post.width || post.image_width,
    height: post.height || post.image_height,
    owner: post.owner || post.owner_name || "",
    previewUrl: absoluteUrl(board.baseUrl, post.preview_url || post.preview_file_url),
    sampleUrl: absoluteUrl(board.baseUrl, post.sample_url || post.large_file_url || ""),
    fileUrl: absoluteUrl(board.baseUrl, post.file_url || post.large_file_url || post.sample_url),
    sampleWidth: asNumber(post.sample_width),
  }));
  const hasMore = parsed.count
    ? (query.page + 1) * limit < parsed.count
    : posts.length >= limit;
  return { posts, hasMore, note: "" };
}

function gelbooru01File(thumbUrl) {
  return thumbUrl
    .replace("://thumbs.", "://img.")
    .replace("/thumbnails//", "//images/")
    .replace("/thumbnail_", "/");
}

function parseGelbooru01(html, baseUrl) {
  const meta = new Map();
  const metaRe =
    /posts\[(\d+)\]\s*=\s*\{'tags':'([\s\S]*?)'\.split\(\/ \/g\),\s*'rating':'([^']*)',\s*'score':(-?\d+),\s*'user':'([^']*)'\}/g;
  for (const match of html.matchAll(metaRe)) {
    meta.set(match[1], {
      tags: splitTags(match[2]),
      rating: match[3],
      score: Number(match[4]),
      owner: decodeHtml(match[5]),
    });
  }
  const posts = [];
  const imgRe = /<a id="p(\d+)"[^>]*>\s*<img src="([^"]+)"/g;
  for (const match of html.matchAll(imgRe)) {
    const info = meta.get(match[1]) || { tags: [], rating: "", score: 0, owner: "" };
    const previewUrl = decodeHtml(match[2]);
    posts.push({
      id: match[1],
      ...info,
      previewUrl,
      sampleUrl: gelbooru01File(previewUrl),
      fileUrl: gelbooru01File(previewUrl),
    });
  }
  if (posts.length === 0 && html.includes('class="thumb"')) {
    throw new BoardError("gelbooru01Parse", 502);
  }
  const serving = html.match(/Serving\s+([\d,]+)\s+posts/i);
  const pids = [...html.matchAll(/[?&](?:amp;)?pid=(\d+)/g)].map((match) => Number(match[1]));
  const maxPid = pids.length ? Math.max(...pids) : 0;
  const total = serving ? Number(serving[1].replace(/,/g, "")) : maxPid + posts.length;
  return { posts, total, baseUrl };
}

async function gelbooru01(board, query) {
  const pageSize = board.pageSize || 20;
  const cacheKey = `${board.baseUrl}|${cleanTags(query.tags)}`;
  let span = spanCache.get(cacheKey);
  if (!span || Date.now() - span.at > 10 * 60 * 1000) {
    const first = await fetchText(listUrl(board, query.tags, 0), board.baseUrl);
    const parsed = parseGelbooru01(first.text, board.baseUrl);
    span = { total: Math.max(parsed.total, parsed.posts.length), at: Date.now(), first: parsed };
    spanCache.set(cacheKey, span);
  }

  let pid = query.page * pageSize;
  if (query.sort === "random") {
    const pages = Math.max(1, Math.ceil(span.total / pageSize));
    const random = mulberry32(query.seed);
    let pick = 0;
    for (let index = 0; index <= query.page; index += 1) pick = Math.floor(random() * pages);
    pid = pick * pageSize;
  }

  const parsed =
    pid === 0 && span.first
      ? span.first
      : parseGelbooru01((await fetchText(listUrl(board, query.tags, pid), board.baseUrl)).text, board.baseUrl);
  if (pid === 0) span.first = parsed;

  let posts = parsed.posts;
  if (query.minScore > 0) posts = posts.filter((post) => post.score >= query.minScore);
  if (query.sort === "score") posts = [...posts].sort((a, b) => b.score - a.score);

  const note =
    query.sort === "score"
      ? "noteScorePage"
      : query.sort === "random"
        ? "noteRandomPages"
        : "";
  return { posts, hasMore: parsed.posts.length >= pageSize, note };
}

function listUrl(board, tags, pid) {
  const url = new URL("/index.php", board.baseUrl);
  url.searchParams.set("page", "post");
  url.searchParams.set("s", "list");
  url.searchParams.set("pid", String(pid));
  const cleaned = cleanTags(tags);
  if (cleaned) url.searchParams.set("tags", cleaned);
  return url.href;
}

function shimmieSearch(query) {
  const parts = [];
  const tags = withoutMeta(query.tags);
  if (tags) parts.push(tags);
  if (query.minScore > 0 && !hasScoreClause(query.tags)) parts.push(`score>=${query.minScore}`);
  if (query.sort === "score") parts.push("order=score_desc");
  return parts.join(" ");
}

function shimmieUrl(baseUrl, search, page) {
  const root = baseUrl.replace(/\/$/, "");
  if (!search) return `${root}/post/list/${page}`;
  return `${root}/post/list/${encodeURIComponent(search)}/${page}`;
}

function parseShimmie(html, baseUrl) {
  const posts = [];
  const re =
    /<a href='\/post\/view\/(\d+)' class='thumb shm-thumb[^']*' data-tags='([^']*)' data-post-id='\d+'><img id='thumb_\d+' title='([^']*)'[^>]*src='([^']+)'/g;
  for (const match of html.matchAll(re)) {
    const size = match[3].match(/(\d+)x(\d+)/);
    posts.push({
      id: match[1],
      tags: splitTags(match[2]),
      score: null,
      rating: "",
      width: size ? Number(size[1]) : 0,
      height: size ? Number(size[2]) : 0,
      previewUrl: absoluteUrl(baseUrl, decodeHtml(match[4])),
      sampleUrl: "",
      fileUrl: "",
      needsResolve: true,
    });
  }
  if (posts.length === 0 && html.includes("shm-thumb")) {
    throw new BoardError("shimmieParse", 502);
  }
  const pages = [...html.matchAll(/\/post\/list\/(?:[^'"\s]+\/)?(\d+)/g)].map((match) => Number(match[1]));
  const maxPage = pages.length ? Math.max(...pages) : posts.length ? 1 : 0;
  return { posts, maxPage };
}

async function shimmie(board, query) {
  const search = shimmieSearch(query);
  if (query.sort !== "random") {
    const page = query.page + 1;
    const { text } = await fetchText(shimmieUrl(board.baseUrl, search, page), board.baseUrl);
    const parsed = parseShimmie(text, board.baseUrl);
    return {
      posts: parsed.posts,
      hasMore: parsed.posts.length > 0 && (parsed.maxPage === 0 || page < parsed.maxPage),
      note: "",
    };
  }

  const first = await fetchText(shimmieUrl(board.baseUrl, search, 1), board.baseUrl);
  const head = parseShimmie(first.text, board.baseUrl);
  const maxPage = Math.max(1, head.maxPage || 1);
  const random = mulberry32(query.seed);
  let pick = 1;
  for (let index = 0; index <= query.page; index += 1) pick = 1 + Math.floor(random() * maxPage);
  const parsed =
    pick === 1 ? head : parseShimmie((await fetchText(shimmieUrl(board.baseUrl, search, pick), board.baseUrl)).text, board.baseUrl);
  return {
    posts: parsed.posts,
    hasMore: maxPage > 1 || parsed.posts.length > 0,
    note: "noteShimmieRandom",
  };
}

async function danbooru(board, query) {
  const limit = 100;
  const tags = [withoutMeta(query.tags)];
  if (query.minScore > 0 && !hasScoreClause(query.tags)) tags.push(`score:>=${query.minScore}`);
  if (query.sort === "score") tags.push("order:score");
  if (query.sort === "random") tags.push(`random:${limit}`);
  const endpoint = new URL("/posts.json", board.apiBase || board.baseUrl);
  endpoint.searchParams.set("limit", String(limit));
  if (query.sort !== "random") endpoint.searchParams.set("page", String(query.page + 1));
  const tagString = tags.filter(Boolean).join(" ");
  if (tagString) endpoint.searchParams.set("tags", tagString);
  if (query.apiKey && query.userId) {
    endpoint.searchParams.set("login", query.userId);
    endpoint.searchParams.set("api_key", query.apiKey);
  }
  const { response, text } = await fetchText(endpoint.href, board.baseUrl);
  if (response.status === 401 || response.status === 403) {
    throw new BoardError("danbooruDenied", response.status);
  }
  const parsed = readJsonPosts(text);
  const posts = parsed.posts
    .filter((post) => post.preview_file_url || post.file_url || post.large_file_url)
    .map((post) => ({
      id: post.id,
      score: post.score,
      rating: post.rating,
      tags: splitTags(post.tag_string || ""),
      width: post.image_width,
      height: post.image_height,
      owner: "",
      previewUrl: absoluteUrl(board.baseUrl, post.preview_file_url),
      sampleUrl: absoluteUrl(board.baseUrl, post.large_file_url || post.file_url),
      fileUrl: absoluteUrl(board.baseUrl, post.file_url || post.large_file_url),
    }));
  return { posts, hasMore: posts.length >= Math.min(limit, 20), note: "" };
}

async function getPosts(body) {
  const board = await sanitizeBoard(body, { allowCustom: true });
  const auth = credentials(body);
  const query = {
    tags: cleanTags(body?.tags),
    sort: ["new", "score", "random"].includes(body?.sort) ? body.sort : "new",
    minScore: Math.max(0, Math.min(100000, Math.floor(Number(body?.minScore) || 0))),
    page: Math.max(0, Math.min(5000, Math.floor(Number(body?.page) || 0))),
    seed: Math.max(1, Math.min(100000, Math.floor(Number(body?.seed) || 1))),
    ...auth,
  };
  if (board.needsAuth && (!auth.apiKey || !auth.userId)) {
    throw new BoardError("authRequired", 401, { name: board.name });
  }
  const loaded =
    board.type === "gelbooru02"
      ? await gelbooru02(board, query)
      : board.type === "gelbooru01"
        ? await gelbooru01(board, query)
        : board.type === "shimmie"
          ? await shimmie(board, query)
          : await danbooru(board, query);
  if (board.type === "shimmie") await fillShimmieFiles(board, loaded.posts);
  const posts = await Promise.all(loaded.posts.map((post) => presentPost(board, post)));
  return { posts: posts.filter((post) => post.previewUrl || post.fileUrl), hasMore: loaded.hasMore, note: loaded.note || "" };
}

async function fillShimmieFiles(board, posts) {
  const queue = posts.filter((post) => !post.fileUrl);
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const post = queue.shift();
      try {
        const { text } = await fetchText(
          `${board.baseUrl.replace(/\/$/, "")}/post/view/${encodeURIComponent(post.id)}`,
          board.baseUrl,
        );
        const match = text.match(/(\/_images\/[^"'<\s]+)/);
        if (!match) continue;
        post.fileUrl = absoluteUrl(board.baseUrl, decodeHtml(match[1]));
        post.sampleUrl = post.fileUrl;
        post.sampleWidth = post.width || 0;
        post.needsResolve = false;
      } catch {
        // Thumbnail bleibt, wenn die Detailseite nicht antwortet.
      }
    }
  });
  await Promise.all(workers);
}

async function resolveOriginal(body) {
  const board = await sanitizeBoard(body, { allowCustom: true });
  const id = String(body?.id || "").replace(/[^\w.-]/g, "");
  if (!id) throw new BoardError("missingPostId");
  if (board.type === "shimmie") {
    const { text } = await fetchText(`${board.baseUrl.replace(/\/$/, "")}/post/view/${encodeURIComponent(id)}`, board.baseUrl);
    const match = text.match(/(\/_images\/[^"'<\s]+)/);
    if (!match) throw new BoardError("originalNotFound", 404);
    const fileUrl = absoluteUrl(board.baseUrl, decodeHtml(match[1]));
    return { fileUrl: await sealUrl(fileUrl, board.baseUrl), kind: mediaKind(fileUrl) };
  }
  if (board.type === "gelbooru01") {
    const url = new URL("/index.php", board.baseUrl);
    url.searchParams.set("page", "post");
    url.searchParams.set("s", "view");
    url.searchParams.set("id", id);
    const { text } = await fetchText(url.href, board.baseUrl);
    const tag = text.match(/<img\b[^>]*id="image"[^>]*>/i);
    const src = tag && tag[0].match(/\ssrc="([^"]+)"/i);
    if (!src) throw new BoardError("originalNotFound", 404);
    const fileUrl = absoluteUrl(board.baseUrl, decodeHtml(src[1]));
    return { fileUrl: await sealUrl(fileUrl, board.baseUrl), kind: mediaKind(fileUrl) };
  }
  throw new BoardError("alreadyHasFile");
}

async function suggestTags(body) {
  const board = await sanitizeBoard(body, { allowCustom: true });
  const q = String(body?.q || "").trim().toLowerCase().replace(/[^\w:.*()!-]/g, "").slice(0, 60);
  if (q.length < 2 || q.includes(":")) return [];
  const auth = credentials(body);
  if (board.type === "gelbooru02") {
    const endpoint = new URL("/autocomplete.php", board.apiBase || board.baseUrl);
    endpoint.searchParams.set("q", q);
    if (auth.apiKey && auth.userId) {
      endpoint.searchParams.set("api_key", auth.apiKey);
      endpoint.searchParams.set("user_id", auth.userId);
    }
    const { response, text } = await fetchText(endpoint.href, board.baseUrl);
    if (!response.ok) return [];
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) return [];
      return data.slice(0, 12).map((item) => ({
        tag: String(item.value || item.name || ""),
        label: String(item.label || item.value || ""),
      })).filter((item) => item.tag);
    } catch {
      return [];
    }
  }
  return [];
}

  return { getPosts, resolveOriginal, suggestTags };
}
