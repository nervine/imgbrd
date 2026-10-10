import { useEffect, useMemo, useRef, useState } from "react";
import { LANGS, normalizeLang, text } from "../../shared/text.js";

const STORAGE = {
  boards: "imgbrd.customBoards",
  collections: "imgbrd.collections",
  credentials: "imgbrd.credentials",
  adult: "imgbrd.adult",
  board: "imgbrd.board",
  columns: "imgbrd.columns",
  lang: "imgbrd.lang",
};

const FALLBACK_BOARDS = [
  { id: "rule34", name: "rule34.xxx", type: "gelbooru02", needsAuth: true, authHelp: "https://rule34.xxx/index.php?page=account&s=options" },
  { id: "boorueu", name: "booru.eu", type: "shimmie" },
  { id: "gelbooru", name: "gelbooru.com", type: "gelbooru02", needsAuth: true, authHelp: "https://gelbooru.com/index.php?page=account&s=options" },
  { id: "xbooru", name: "xbooru.com", type: "gelbooru02" },
  { id: "allgirl", name: "allgirl.booru.org", type: "gelbooru01" },
  { id: "zoo", name: "zoo.booru.org", type: "gelbooru01" },
  { id: "guro", name: "guro.booru.org", type: "gelbooru01" },
];

const TYPE_LABELS = {
  gelbooru02: "Gelbooru 0.2 (JSON API)",
  gelbooru01: "Gelbooru 0.1 (booru.org)",
  shimmie: "Shimmie",
  danbooru: "Danbooru",
};

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function initialQuery() {
  const params = new URLSearchParams(location.search);
  const sort = params.get("sort");
  return {
    boardId: params.get("board") || localStorage.getItem(STORAGE.board) || "xbooru",
    tags: params.get("tags") || "",
    sort: sort === "score" || sort === "random" ? sort : "new",
    minScore: Math.max(0, Math.floor(Number(params.get("score")) || 0)),
    seed: 1 + Math.floor(Math.random() * 90000),
    nonce: 0,
  };
}

function tokens(tags) {
  return String(tags || "").split(/\s+/).filter(Boolean);
}

function columnDevicePixels(columnsSetting, viewport) {
  const wide = viewport.width >= 961;
  const count = columnsSetting === "auto" ? (wide ? 2 : 1) : Number(columnsSetting) || 1;
  const sidebar = wide ? 360 : 40;
  const column = Math.max(160, (viewport.width - sidebar) / count);
  return Math.ceil(column * (viewport.ratio || 1));
}

function cardImage(post, need) {
  if (post.kind === "video") return post.previewUrl || post.sampleUrl || post.fileUrl;
  if (post.sampleUrl && post.sampleWidth >= need) return post.sampleUrl;
  return post.fileUrl || post.sampleUrl || post.previewUrl;
}

function parseCredentialPaste(value) {
  const text = String(value || "").trim();
  const apiKey = text.match(/(?:^|[?&\s])api_key=([A-Za-z0-9]+)/i)?.[1] || "";
  const userId = text.match(/(?:^|[?&\s])user_id=([A-Za-z0-9]+)/i)?.[1] || "";
  if (!apiKey && !userId) return null;
  return { apiKey, userId };
}

function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

async function postJson(url, body) {
  if (isNativeApp()) {
    const { nativePost } = await import("./nativeApi.js");
    return nativePost(url, body);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return data;
}

function BoardVideo({ src, referer }) {
  const tried = useRef(false);
  const [shown, setShown] = useState(src);
  useEffect(() => {
    tried.current = false;
    setShown(src);
  }, [src]);
  useEffect(() => () => {
    if (String(shown).startsWith("blob:")) URL.revokeObjectURL(shown);
  }, [shown]);
  return (
    <video
      key={shown}
      src={shown}
      controls
      autoPlay
      onError={() => {
        if (!isNativeApp() || tried.current || !src) return;
        tried.current = true;
        import("./nativeApi.js")
          .then(({ loadMediaObjectUrl }) => loadMediaObjectUrl(src, referer))
          .then((url) => {
            if (url) setShown(url);
          })
          .catch(() => {});
      }}
    />
  );
}

function BoardImage({ src, referer, onGiveUp, ...props }) {
  const tried = useRef(false);
  const [shown, setShown] = useState(src);
  useEffect(() => {
    tried.current = false;
    setShown(src);
  }, [src]);
  useEffect(() => () => {
    if (String(shown).startsWith("blob:")) URL.revokeObjectURL(shown);
  }, [shown]);
  return (
    <img
      {...props}
      src={shown}
      onError={() => {
        if (!isNativeApp() || tried.current || !src) {
          onGiveUp?.();
          return;
        }
        tried.current = true;
        import("./nativeApi.js")
          .then(({ loadMediaObjectUrl }) => loadMediaObjectUrl(src, referer))
          .then((url) => {
            if (url) setShown(url);
            else onGiveUp?.();
          })
          .catch(() => onGiveUp?.());
      }}
    />
  );
}

export function App() {
  const [lang, setLang] = useState(() => normalizeLang(localStorage.getItem(STORAGE.lang)));
  const [adult, setAdult] = useState(() => localStorage.getItem(STORAGE.adult) === "1");
  const [builtin, setBuiltin] = useState(FALLBACK_BOARDS);
  const [customBoards, setCustomBoards] = useState(() => readJson(STORAGE.boards, []));
  const [collections, setCollections] = useState(() => readJson(STORAGE.collections, []));
  const [credentials, setCredentials] = useState(() => readJson(STORAGE.credentials, {}));
  const [query, setQuery] = useState(initialQuery);
  const [draftTags, setDraftTags] = useState(query.tags);
  const [draftScore, setDraftScore] = useState(query.minScore);
  const [columns, setColumns] = useState(() => {
    const saved = localStorage.getItem(STORAGE.columns);
    return ["auto", "1", "2", "3", "4", "5"].includes(saved) ? saved : "auto";
  });
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    ratio: window.devicePixelRatio || 1,
  }));
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [active, setActive] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tagMenu, setTagMenu] = useState(null);
  const [collectionForm, setCollectionForm] = useState({ name: "", tags: "", bind: true });
  const [boardForm, setBoardForm] = useState({
    name: "",
    baseUrl: "",
    apiBase: "",
    type: "gelbooru02",
    needsAuth: false,
  });
  const [credDraft, setCredDraft] = useState({ userId: "", apiKey: "" });

  const boards = useMemo(() => [...builtin, ...customBoards], [builtin, customBoards]);
  const t = (key, vars) => text(lang, key, vars);
  const explain = (value) => {
    if (!value) return "";
    if (typeof value === "string") return text(lang, value);
    return text(lang, value.error || "", value.vars);
  };
  const board = boards.find((item) => item.id === query.boardId) || boards[0];
  const boardsRef = useRef(boards);
  const credentialsRef = useRef(credentials);
  const queryRef = useRef(query);
  const seenRef = useRef(new Set());
  const pageRef = useRef(0);
  const bufferRef = useRef([]);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const sentinelRef = useRef(null);
  const fileRef = useRef(null);

  boardsRef.current = boards;
  credentialsRef.current = credentials;
  queryRef.current = query;

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem(STORAGE.lang, lang);
  }, [lang]);

  useEffect(() => {
    if (!searchOpen) return;
    document.querySelector(".search-sheet input")?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, ratio: window.devicePixelRatio || 1 });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (isNativeApp()) {
      import("./nativeApi.js").then(({ nativeBoards }) => setBuiltin(nativeBoards()));
      return undefined;
    }
    fetch("/api/boards")
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.boards) && data.boards.length) setBuiltin(data.boards);
      })
      .catch(() => {});
    return undefined;
  }, []);

  useEffect(() => {
    const saved = credentials[board?.id] || { userId: "", apiKey: "" };
    setCredDraft(saved);
  }, [board?.id, credentials]);

  useEffect(() => {
    if (!board) return;
    const params = new URLSearchParams();
    params.set("board", board.id);
    if (query.tags) params.set("tags", query.tags);
    if (query.sort !== "new") params.set("sort", query.sort);
    if (query.minScore) params.set("score", String(query.minScore));
    history.replaceState(null, "", `?${params.toString()}`);
    localStorage.setItem(STORAGE.board, board.id);
  }, [board, query]);

  useEffect(() => {
    if (!adult) return undefined;
    const requestId = ++requestRef.current;
    let cancelled = false;
    seenRef.current = new Set();
    pageRef.current = 0;
    bufferRef.current = [];
    hasMoreRef.current = true;
    loadingRef.current = true;
    setPosts([]);
    setError("");
    setNote("");
    setLoading(true);
    setActive(null);
    window.scrollTo(0, 0);

    (async () => {
      const first = await takeStep(requestId);
      if (!cancelled && requestId === requestRef.current) {
        setPosts(first || []);
        loadingRef.current = false;
        setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setError("serverDown");
        loadingRef.current = false;
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [adult, query]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !adult) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [adult, posts.length, query]);

  useEffect(() => {
    const token = tokens(draftTags).at(-1) || "";
    if (!adult || !searchFocused || token.length < 2 || token.includes(":")) {
      setSuggestions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const data = await postJson("/api/suggest", { ...payloadFor(board, credentials, query), q: token, page: 0 });
      setSuggestions(Array.isArray(data.tags) ? data.tags : []);
    }, 220);
    return () => clearTimeout(timer);
  }, [draftTags, board, credentials, adult, query.seed, searchFocused]);

  useEffect(() => {
    if (!active?.needsResolve) return undefined;
    let cancelled = false;
    postJson("/api/resolve", { ...payloadFor(board, credentials, query), id: active.id }).then((data) => {
      if (cancelled || !data.fileUrl) return;
      const next = { ...active, fileUrl: data.fileUrl, sampleUrl: data.fileUrl, needsResolve: false, kind: data.kind || active.kind };
      setActive(next);
      setPosts((current) => current.map((post) => (post.id === next.id ? next : post)));
    });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.needsResolve]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (tagMenu) setTagMenu(null);
        else setActive(null);
        return;
      }
      if (tagMenu) return;
      if (event.key === "ArrowRight") shift(1);
      if (event.key === "ArrowLeft") shift(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, posts, tagMenu]);

  useEffect(() => {
    if (!tagMenu) return undefined;
    const onPointer = (event) => {
      if (event.target.closest(".tag-menu, .tagbox button")) return;
      setTagMenu(null);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [tagMenu]);

  function payloadFor(currentBoard, creds, currentQuery, page = 0) {
    const auth = creds[currentBoard?.id] || {};
    const body = {
      tags: currentQuery.tags,
      sort: currentQuery.sort,
      minScore: currentQuery.minScore,
      page,
      seed: currentQuery.seed,
      apiKey: auth.apiKey || "",
      userId: auth.userId || "",
    };
    if (currentBoard?.custom) return { ...body, board: currentBoard };
    return { ...body, boardId: currentBoard?.id };
  }

  function fetchPage(currentQuery, page) {
    const currentBoard = boardsRef.current.find((item) => item.id === currentQuery.boardId);
    if (!currentBoard) return Promise.resolve({ error: "missingBoard", posts: [], hasMore: false });
    return postJson("/api/posts", payloadFor(currentBoard, credentialsRef.current, currentQuery, page));
  }

  function unseen(list) {
    const fresh = [];
    for (const post of list || []) {
      if (seenRef.current.has(post.id)) continue;
      seenRef.current.add(post.id);
      fresh.push(post);
    }
    return fresh;
  }

  async function takeStep(requestId) {
    const batch = [];
    let empty = 0;
    while (batch.length < 100 && bufferRef.current.length) batch.push(bufferRef.current.shift());
    while (batch.length < 100 && empty < 8 && hasMoreRef.current && requestId === requestRef.current) {
      const data = await fetchPage(queryRef.current, pageRef.current);
      if (requestId !== requestRef.current) return null;
      pageRef.current += 1;
      hasMoreRef.current = Boolean(data.hasMore);
      if (data.note) setNote(data.note);
      const fresh = unseen(data.posts);
      if (data.error && fresh.length === 0 && batch.length === 0) {
        setError(data);
        hasMoreRef.current = false;
        break;
      }
      if (!fresh.length) {
        if (!data.hasMore) break;
        empty += 1;
        continue;
      }
      empty = 0;
      for (const post of fresh) {
        if (batch.length < 100) batch.push(post);
        else bufferRef.current.push(post);
      }
      if (!data.hasMore) break;
    }
    return batch;
  }

  async function loadMore() {
    if (loadingRef.current || !hasMoreRef.current) return;
    const requestId = requestRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const batch = await takeStep(requestId);
      if (requestId !== requestRef.current || !batch?.length) return;
      setPosts((current) => [...current, ...batch]);
    } catch {
      setError("moreFailed");
    } finally {
      if (requestId === requestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }

  function commitSearch(event) {
    event?.preventDefault();
    const minScore = Math.max(0, Math.floor(Number(draftScore) || 0));
    setSuggestions([]);
    setSearchOpen(false);
    setQuery((current) => ({
      ...current,
      tags: draftTags.trim(),
      minScore,
      nonce: current.nonce + 1,
    }));
  }

  function setSort(sort) {
    const minScore = Math.max(0, Math.floor(Number(draftScore) || 0));
    setQuery((current) => ({
      ...current,
      sort,
      minScore,
      seed: sort === "random" ? 1 + Math.floor(Math.random() * 90000) : current.seed,
      nonce: current.nonce + 1,
    }));
  }

  function reshuffle() {
    setQuery((current) => ({ ...current, seed: 1 + Math.floor(Math.random() * 90000), nonce: current.nonce + 1 }));
  }

  function chooseBoard(boardId) {
    setQuery((current) => ({ ...current, boardId, nonce: current.nonce + 1 }));
    setDrawer(false);
  }

  function openTagMenu(event, tag) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = Math.min(288, window.innerWidth - 16);
    const menuHeight = 220;
    setTagMenu({
      tag,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8)),
    });
  }

  function runTagAction(action) {
    if (!tagMenu) return;
    const tag = tagMenu.tag;
    const current = tokens(query.tags).filter((item) => item !== tag && item !== `-${tag}`);
    let tags = current;
    if (action === "add") tags = [...current, tag];
    if (action === "exclude") tags = [...current, `-${tag}`];
    if (action === "only" || action === "window") tags = [tag];
    const next = tags.join(" ");
    setTagMenu(null);
    if (action === "window") {
      const params = new URLSearchParams();
      params.set("board", board.id);
      params.set("tags", next);
      window.open(`${location.pathname}?${params.toString()}`, "_blank", "noopener");
      return;
    }
    setDraftTags(next);
    setSearchOpen(false);
    setQuery((state) => ({ ...state, tags: next, nonce: state.nonce + 1 }));
  }

  function toggleTag(tag) {
    const next = new Set(tokens(query.tags));
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    const tags = [...next].join(" ");
    setDraftTags(tags);
    setQuery((current) => ({ ...current, tags, nonce: current.nonce + 1 }));
  }

  function applySuggestion(tag) {
    const parts = tokens(draftTags);
    parts.pop();
    parts.push(tag);
    const tags = parts.join(" ");
    setDraftTags(`${tags} `);
    setSuggestions([]);
  }

  function updateCredentials(field, value) {
    const parsed = parseCredentialPaste(value);
    if (parsed) {
      setCredDraft({
        apiKey: parsed.apiKey || credDraft.apiKey,
        userId: parsed.userId || credDraft.userId,
      });
      return;
    }
    setCredDraft({ ...credDraft, [field]: value });
  }

  function saveCredentials(event) {
    event.preventDefault();
    const parsedKey = parseCredentialPaste(credDraft.apiKey);
    const parsedId = parseCredentialPaste(credDraft.userId);
    const saved = {
      userId: (parsedId?.userId || parsedKey?.userId || credDraft.userId).trim(),
      apiKey: (parsedKey?.apiKey || credDraft.apiKey).trim(),
    };
    setCredDraft(saved);
    const next = { ...credentials, [board.id]: saved };
    setCredentials(next);
    writeJson(STORAGE.credentials, next);
    setQuery((current) => ({ ...current, nonce: current.nonce + 1 }));
  }

  function saveCollection(event) {
    event.preventDefault();
    const name = collectionForm.name.trim();
    const tags = (collectionForm.tags || query.tags || draftTags).trim();
    if (!name || !tags) return;
    const next = [
      { id: crypto.randomUUID(), name, tags, boardId: collectionForm.bind ? board.id : "", createdAt: Date.now() },
      ...collections,
    ];
    setCollections(next);
    writeJson(STORAGE.collections, next);
    setCollectionForm({ name: "", tags: "", bind: true });
  }

  function removeCollection(id) {
    const next = collections.filter((item) => item.id !== id);
    setCollections(next);
    writeJson(STORAGE.collections, next);
  }

  function applyCollection(item) {
    const merged = tokens(query.tags);
    const seen = new Set(merged);
    for (const tag of tokens(item.tags)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      merged.push(tag);
    }
    const tags = merged.join(" ");
    setDraftTags(tags);
    setQuery((current) => ({
      ...current,
      tags,
      boardId: boards.some((entry) => entry.id === item.boardId) ? item.boardId : current.boardId,
      nonce: current.nonce + 1,
    }));
    setDrawer(false);
    setSearchOpen(false);
  }

  function saveBoard(event) {
    event.preventDefault();
    const name = boardForm.name.trim();
    const baseUrl = boardForm.baseUrl.trim();
    if (!name || !baseUrl) return;
    const entry = {
      id: `custom-${crypto.randomUUID()}`,
      name,
      type: boardForm.type,
      baseUrl,
      apiBase: boardForm.apiBase.trim(),
      needsAuth: boardForm.needsAuth,
      custom: true,
    };
    const next = [...customBoards, entry];
    setCustomBoards(next);
    writeJson(STORAGE.boards, next);
    setBoardForm({ name: "", baseUrl: "", apiBase: "", type: "gelbooru02", needsAuth: false });
    chooseBoard(entry.id);
  }

  function removeBoard(id) {
    const next = customBoards.filter((item) => item.id !== id);
    setCustomBoards(next);
    writeJson(STORAGE.boards, next);
    if (query.boardId === id) chooseBoard("xbooru");
  }

  async function exportBackup() {
    const json = JSON.stringify({ collections, boards: customBoards, credentials }, null, 2);
    if (isNativeApp()) {
      try {
        const { exportJson } = await import("./nativeApi.js");
        await exportJson(json, { title: t("backupTitle"), dialog: t("backupDialog") });
      } catch (error) {
        if (!/cancel/i.test(error?.message || "")) setError("shareFailed");
      }
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "imgbrd-sicherung.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Array.isArray(data.collections)) {
        setCollections(data.collections);
        writeJson(STORAGE.collections, data.collections);
      }
      if (Array.isArray(data.boards)) {
        const imported = data.boards
          .filter((item) => item && item.name && item.baseUrl && item.type)
          .map((item) => ({ ...item, custom: true, id: item.id || `custom-${crypto.randomUUID()}` }));
        setCustomBoards(imported);
        writeJson(STORAGE.boards, imported);
      }
      if (data.credentials && typeof data.credentials === "object" && !Array.isArray(data.credentials)) {
        const next = { ...credentials };
        for (const [id, value] of Object.entries(data.credentials)) {
          if (!value || typeof value !== "object") continue;
          next[id] = {
            userId: String(value.userId || "").slice(0, 120),
            apiKey: String(value.apiKey || "").slice(0, 200),
          };
        }
        setCredentials(next);
        writeJson(STORAGE.credentials, next);
      }
    } catch {
      setError("backupUnreadable");
    }
  }

  async function recoverOriginal(post) {
    if (!post || post.retried) return;
    const data = await postJson("/api/resolve", { ...payloadFor(board, credentials, query), id: post.id });
    if (!data.fileUrl) return;
    const next = { ...post, fileUrl: data.fileUrl, sampleUrl: data.fileUrl, needsResolve: false, retried: true, kind: data.kind || post.kind };
    setActive(next);
    setPosts((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  function shift(delta) {
    if (!active) return;
    const index = posts.findIndex((post) => post.id === active.id);
    const next = posts[index + delta];
    if (next) setActive(next);
  }

  const activeIndex = active ? posts.findIndex((post) => post.id === active.id) : -1;

  return (
    <div className="app">
      {!adult && (
        <div className="gate">
          <section className="panel">
            <h2>{t("ageTitle")}</h2>
            <p>{t("ageBody")}</p>
            <button
              className="primary"
              onClick={() => {
                localStorage.setItem(STORAGE.adult, "1");
                setAdult(true);
              }}
            >
              {t("ageButton")}
            </button>
          </section>
        </div>
      )}

      <header className="top">
        <div className="brand">
          <div className="mark">ib</div>
          <div className="brand-text">
            <strong>imgbrd</strong>
            <small>{t("tagline")}</small>
          </div>
        </div>
        <label className="field board-desktop">
          <span>{t("imageboard")}</span>
          <select value={board?.id || ""} onChange={(event) => chooseBoard(event.target.value)}>
            <optgroup label={t("builtin")}>
              {builtin.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </optgroup>
            {customBoards.length > 0 && (
              <optgroup label={t("custom")}>
                {customBoards.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <form className="search search-desktop" onSubmit={commitSearch}>
          <input
            value={draftTags}
            placeholder={t("tagsPlaceholder")}
            aria-label={t("tags")}
            onChange={(event) => setDraftTags(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
          />
          <button className="primary" type="submit">{t("search")}</button>
          {suggestions.length > 0 && (
            <ul className="suggest">
              {suggestions.map((item) => (
                <li key={item.tag}>
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySuggestion(item.tag)}>
                    {item.label || item.tag}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <div className="top-actions">
          <button
            className="icon-btn"
            type="button"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen((open) => !open);
              setDrawer(false);
            }}
          >
            {t("searchNoun")}
          </button>
          <button className="menu" type="button" onClick={() => { setDrawer(true); setSearchOpen(false); }}>{t("menu")}</button>
        </div>
      </header>
      {searchOpen && (
        <section className="search-sheet">
          <form className="search" onSubmit={commitSearch}>
            <input
              value={draftTags}
              placeholder={t("tagsPlaceholder")}
              aria-label={t("tags")}
              onChange={(event) => setDraftTags(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
            <button className="primary" type="submit">{t("search")}</button>
            {suggestions.length > 0 && (
              <ul className="suggest">
                {suggestions.map((item) => (
                  <li key={item.tag}>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySuggestion(item.tag)}>
                      {item.label || item.tag}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </form>
          <div>
            <h2>{t("collections")}</h2>
            <div className="list">
              {collections.length === 0 && <small className="muted">{t("noCollectionsMenu")}</small>}
              {collections.map((item) => (
                <button className="item" type="button" key={item.id} onClick={() => applyCollection(item)}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.tags}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="toolbar">
        <div className="segment" role="group" aria-label={t("sort")}>
          {[
            ["new", t("newest")],
            ["score", t("score")],
            ["random", t("random")],
          ].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={query.sort === id} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="score-field">
          <span>{t("columns")}</span>
          <select
            aria-label={t("columns")}
            value={columns}
            onChange={(event) => {
              setColumns(event.target.value);
              localStorage.setItem(STORAGE.columns, event.target.value);
            }}
          >
            <option value="auto">{t("auto")}</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </label>
        <label className="score-field">
          <span>{t("minScore")}</span>
          <input
            type="number"
            min="0"
            value={draftScore}
            onChange={(event) => setDraftScore(event.target.value)}
            onBlur={commitSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitSearch(event);
            }}
          />
        </label>
        {query.sort === "random" && (
          <button className="ghost" type="button" onClick={reshuffle}>{t("reshuffle")}</button>
        )}
      </div>

      {board?.needsAuth && !(credentials[board.id]?.apiKey && credentials[board.id]?.userId) && (
        <p className="banner">
          {t("authBanner", { name: board.name })}
          {board.authHelp && (
            <>
              {" "}
              <a href={board.authHelp} target="_blank" rel="noreferrer">{t("createHere")}</a>
              {t("thenAccess")}
            </>
          )}
        </p>
      )}
      {note && <p className="note">{t(note)}</p>}
      {error && <p className="status error">{explain(error)}</p>}
      {tokens(query.tags).length > 0 && (
        <div className="chips">
          {tokens(query.tags).map((tag) => (
            <button key={tag} className="chip" type="button" onClick={() => toggleTag(tag)}>
              {tag} ×
            </button>
          ))}
        </div>
      )}

      <div className="layout">
        {drawer && <button className="backdrop" aria-label={t("closeMenu")} onClick={() => setDrawer(false)} />}
        <aside className={drawer ? "sidebar open" : "sidebar"}>
          <button className="drawer-close" type="button" onClick={() => setDrawer(false)}>{t("close")}</button>
          <section className="panel">
            <h2>{t("language")}</h2>
            <label className="field">
              <select aria-label={t("language")} value={lang} onChange={(event) => setLang(normalizeLang(event.target.value))}>
                {LANGS.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
          </section>
          <section className="panel board-in-menu">
            <h2>{t("imageboard")}</h2>
            <label className="field">
              <select aria-label={t("imageboard")} value={board?.id || ""} onChange={(event) => chooseBoard(event.target.value)}>
                <optgroup label={t("builtin")}>
                  {builtin.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </optgroup>
                {customBoards.length > 0 && (
                  <optgroup label={t("custom")}>
                    {customBoards.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </section>
          <section className="panel">
            <h2>{t("accessFor", { name: board?.name })}</h2>
            <form className="stack" onSubmit={saveCredentials}>
              <input
                placeholder={t("userIdPlaceholder")}
                value={credDraft.userId}
                onChange={(event) => updateCredentials("userId", event.target.value)}
                autoComplete="off"
              />
              <input
                placeholder={t("apiKey")}
                value={credDraft.apiKey}
                onChange={(event) => updateCredentials("apiKey", event.target.value)}
                autoComplete="off"
              />
              <button className="primary" type="submit">{t("saveForBoard")}</button>
              <small className="muted">{t("accessHint")}</small>
            </form>
          </section>

          <section className="panel">
            <h2>{t("collections")}</h2>
            <form className="stack" onSubmit={saveCollection}>
              <input
                placeholder={t("collectionName")}
                value={collectionForm.name}
                onChange={(event) => setCollectionForm({ ...collectionForm, name: event.target.value })}
              />
              <input
                placeholder={t("tags")}
                value={collectionForm.tags}
                onChange={(event) => setCollectionForm({ ...collectionForm, tags: event.target.value })}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={collectionForm.bind}
                  onChange={(event) => setCollectionForm({ ...collectionForm, bind: event.target.checked })}
                />
                {t("bindBoard")}
              </label>
              <button className="primary" type="submit">{t("saveSearch")}</button>
            </form>
            <div className="list">
              {collections.length === 0 && <small className="muted">{t("noCollections")}</small>}
              {collections.map((item) => (
                <div className="item" key={item.id}>
                  <button className="grow" type="button" onClick={() => applyCollection(item)}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.tags}</small>
                    </span>
                  </button>
                  <button className="ghost danger" type="button" onClick={() => removeCollection(item.id)} aria-label={t("delete")}>×</button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>{t("customBoard")}</h2>
            <form className="stack" onSubmit={saveBoard}>
              <input placeholder={t("collectionName")} value={boardForm.name} onChange={(event) => setBoardForm({ ...boardForm, name: event.target.value })} />
              <input placeholder={t("basePlaceholder")} value={boardForm.baseUrl} onChange={(event) => setBoardForm({ ...boardForm, baseUrl: event.target.value })} />
              <input placeholder={t("apiHostPlaceholder")} value={boardForm.apiBase} onChange={(event) => setBoardForm({ ...boardForm, apiBase: event.target.value })} />
              <select value={boardForm.type} onChange={(event) => setBoardForm({ ...boardForm, type: event.target.value })}>
                {Object.entries(TYPE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <label className="check">
                <input type="checkbox" checked={boardForm.needsAuth} onChange={(event) => setBoardForm({ ...boardForm, needsAuth: event.target.checked })} />
                {t("requireApiKey")}
              </label>
              <button className="primary" type="submit">{t("addBoard")}</button>
            </form>
            <div className="list">
              {customBoards.map((item) => (
                <div className="item" key={item.id}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{TYPE_LABELS[item.type] || item.type}</small>
                  </span>
                  <button className="ghost danger" type="button" onClick={() => removeBoard(item.id)} aria-label={t("delete")}>×</button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>{t("backup")}</h2>
            <div className="row">
              <button className="ghost" type="button" onClick={exportBackup}>{t("export")}</button>
              <button className="ghost" type="button" onClick={() => fileRef.current?.click()}>{t("import")}</button>
              <input ref={fileRef} hidden type="file" accept="application/json" onChange={importBackup} />
            </div>
            <small className="muted">{t("backupHint")}</small>
          </section>
        </aside>

        <main>
          <p className="status">{loading && posts.length === 0 ? t("loadingResults") : t("resultsLoaded", { count: posts.length })}</p>
          <div className="grid" data-columns={columns}>
            {posts.map((post) => (
              <button className="card" type="button" key={`${board?.id}-${post.id}`} onClick={() => setActive(post)}>
                <BoardImage
                  src={cardImage(post, columnDevicePixels(columns, viewport))}
                  referer={post.pageUrl}
                  alt=""
                  width={post.width || undefined}
                  height={post.height || undefined}
                  style={{ aspectRatio: post.width && post.height ? `${post.width} / ${post.height}` : "3 / 4" }}
                  loading="lazy"
                  decoding="async"
                />
                <span className="badge">
                  {typeof post.score === "number" && <span>{post.score}</span>}
                  {post.rating && post.rating !== "unknown" && <span>{post.rating}</span>}
                  {post.kind === "video" && <span>{t("video")}</span>}
                </span>
              </button>
            ))}
            {loading && posts.length === 0 && Array.from({ length: 8 }, (_, index) => <div className="skeleton" key={index} />)}
          </div>
          {!loading && posts.length === 0 && !error && adult && <p className="status">{t("noResults")}</p>}
          <div ref={sentinelRef} className="sentinel" />
          {loading && posts.length > 0 && <p className="status">{t("loadingMore")}</p>}
        </main>
      </div>

      {tagMenu && (
        <div className="tag-menu" style={{ left: tagMenu.x, top: tagMenu.y }} role="menu">
          <p>{tagMenu.tag}</p>
          <button type="button" onClick={() => runTagAction("add")}>{t("tagAdd")}</button>
          <button type="button" onClick={() => runTagAction("exclude")}>{t("tagExclude")}</button>
          <button type="button" onClick={() => runTagAction("only")}>{t("tagOnly")}</button>
          <button type="button" onClick={() => runTagAction("window")}>{t("tagWindow")}</button>
        </div>
      )}

      {active && (
        <div className="lightbox" role="dialog" aria-modal="true">
          <div className="stage">
            <button className="close" type="button" onClick={() => setActive(null)} aria-label={t("close")}>×</button>
            <button className="nav prev" type="button" disabled={activeIndex <= 0} onClick={() => shift(-1)} aria-label={t("previous")}>‹</button>
            {active.kind === "video" && active.fileUrl ? (
              <BoardVideo src={active.fileUrl} referer={active.pageUrl} />
            ) : active.fileUrl || active.sampleUrl ? (
              <BoardImage
                src={active.fileUrl || active.sampleUrl}
                referer={active.pageUrl}
                alt=""
                onGiveUp={() => recoverOriginal(active)}
              />
            ) : (
              <p>{t("loadingOriginal")}</p>
            )}
            <button className="nav next" type="button" disabled={activeIndex < 0 || activeIndex >= posts.length - 1} onClick={() => shift(1)} aria-label={t("next")}>›</button>
          </div>
          <aside className="details">
            <h3>#{active.id}</h3>
            <p className="muted">
              {typeof active.score === "number" ? `${t("score")} ${active.score}` : t("scoreUnknown")}
              {active.rating ? ` · ${active.rating}` : ""}
              {active.owner ? ` · ${active.owner}` : ""}
            </p>
            <div className="links">
              <a href={active.pageUrl} target="_blank" rel="noreferrer">{t("openOnBoard")}</a>
            </div>
            <div className="tagbox">
              {active.tags.map((tag) => (
                <button key={tag} type="button" onClick={(event) => openTagMenu(event, tag)}>{tag}</button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
