import { createApi } from "../shared/engine.js";
import { BOARD_TYPES, findBoard } from "./boards.js";
import {
  BoardError,
  absoluteUrl,
  assertPublicHttpUrl,
  decodeHtml,
  fetchText,
  mediaKind,
  mulberry32,
  pageUrl,
  safeFetch,
  sealUrl,
  splitTags,
} from "./net.js";

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

export const getPosts = api.getPosts;
export const resolveOriginal = api.resolveOriginal;
export const suggestTags = api.suggestTags;

export async function openMedia(token, unseal) {
  const payload = unseal(token);
  if (!payload?.url) return null;
  await assertPublicHttpUrl(payload.url);
  const response = await safeFetch(payload.url, {
    referer: payload.referer || undefined,
    accept: "image/avif,image/webp,image/*,video/*,*/*;q=0.8",
    timeout: 60000,
  });
  return { response, finalUrl: payload.url };
}
