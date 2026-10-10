export const BOARD_TYPES = ["gelbooru02", "gelbooru01", "shimmie", "danbooru"];

export const BOARDS = [
  {
    id: "rule34",
    name: "rule34.xxx",
    type: "gelbooru02",
    baseUrl: "https://rule34.xxx",
    apiBase: "https://api.rule34.xxx",
    needsAuth: true,
    authHelp: "https://rule34.xxx/index.php?page=account&s=options",
  },
  {
    id: "boorueu",
    name: "booru.eu",
    type: "shimmie",
    baseUrl: "https://booru.eu",
    pageSize: 20,
  },
  {
    id: "gelbooru",
    name: "gelbooru.com",
    type: "gelbooru02",
    baseUrl: "https://gelbooru.com",
    apiBase: "https://gelbooru.com",
    needsAuth: true,
    authHelp: "https://gelbooru.com/index.php?page=account&s=options",
  },
  {
    id: "xbooru",
    name: "xbooru.com",
    type: "gelbooru02",
    baseUrl: "https://xbooru.com",
    apiBase: "https://xbooru.com",
  },
  {
    id: "allgirl",
    name: "allgirl.booru.org",
    type: "gelbooru01",
    baseUrl: "https://allgirl.booru.org",
    pageSize: 20,
  },
  {
    id: "zoo",
    name: "zoo.booru.org",
    type: "gelbooru01",
    baseUrl: "https://zoo.booru.org",
    pageSize: 20,
  },
  {
    id: "guro",
    name: "guro.booru.org",
    type: "gelbooru01",
    baseUrl: "https://guro.booru.org",
    pageSize: 20,
  },
];

export function publicBoard(board) {
  return {
    id: board.id,
    name: board.name,
    type: board.type,
    needsAuth: Boolean(board.needsAuth),
    authHelp: board.authHelp || "",
    custom: Boolean(board.custom),
  };
}

export function findBoard(id) {
  return BOARDS.find((board) => board.id === id) || null;
}
