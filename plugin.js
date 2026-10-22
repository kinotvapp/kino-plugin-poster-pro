// Poster Pro: fills the poster (and, if the person wants it, the backdrop) that Kino could not find for a
// title of ANY source. It lists nothing and plays nothing: Kino asks it only about a title that has a gap
// (its `meta` runs after TMDB and AniList, and only fills what they left empty).
//
// Where a poster comes from, in order, each one CHECKED before it is handed over (a link that does not
// answer is never given to Kino, so a gap is filled with a real image or left alone):
//   1. the preferred image server (OpenPosterDB or RatingPosterDB), with the notes drawn on it;
//   2. the other server, which takes the same free key;
//   3. TMDB's own image list for the title in every language (the poster Kino's language filter missed).
//
// What the servers really do (measured, not assumed):
//   - OpenPosterDB answers 404/500 for a title it does not know, so its answer can be trusted.
//   - RatingPosterDB answers a 200 with a generic picture for an IMDb id it does not know, but 404 for a
//     TMDB id it does not know. So RatingPosterDB is only ever asked with a TMDB id (an IMDb id is turned
//     into one through TMDB first).
//   - The free public key works on both servers.

const SERVERS = {
  openposterdb: "https://openposterdb.com",
  rpdb: "https://api.ratingposterdb.com",
};
const FREE_KEY = "t0-free-rpdb";
const TMDB_IMG = { poster: "https://image.tmdb.org/t/p/w500", backdrop: "https://image.tmdb.org/t/p/w780" };
const IMDB_ID = /^tt\d{5,10}$/;
const TMDB_ID = /^[1-9]\d{0,9}$/;

// Kino gives a `meta` call 6 s, and three timeouts in a row switch a plugin off: every step is cut to what
// is left of this budget and the answer is `null` (nothing to add) rather than a throw.
const BUDGET_MS = 4500;
const PROBE_MS = 2200;
const TMDB_MS = 2200;
// A verdict is worth keeping: the next time the same title shows a gap, nothing is asked again. A "no"
// is kept far shorter, because a server can be down for an hour and have the image the next.
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 30 * 60 * 1000;
const STORE_PREFIX = "pp1:";

const TEXT = {
  es: {
    noClave: "La clave no puede tener espacios",
    ok: "ok",
    down: "no responde",
    backdropOk: "fondos ✓",
    backdropNo: "fondos: no",
    tmdbOk: "TMDB ✓",
    tmdbNo: "TMDB: no responde",
    cantCheck: "No se pudo consultar los servidores",
  },
  en: {
    noClave: "The key cannot contain spaces",
    ok: "ok",
    down: "not answering",
    backdropOk: "backdrops ✓",
    backdropNo: "backdrops: no",
    tmdbOk: "TMDB ✓",
    tmdbNo: "TMDB: not answering",
    cantCheck: "Could not reach the servers",
  },
};

function t(key) {
  return (kino.lang === "en-US" ? TEXT.en : TEXT.es)[key];
}

function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // a lost line never breaks an answer
  }
}

function setting(name, fallback) {
  try {
    const value = kino.config.get(name);
    return value === undefined || value === null || value === "" ? fallback : value;
  } catch {
    return fallback;
  }
}

// Only an explicit true (or the text "true") turns a toggle on.
function isOn(name, fallback) {
  const value = setting(name, fallback);
  return value === true || value === "true";
}

// TMDB has no "es-CO": Spanish is asked as es-MX, as the servers also take it.
function lang() {
  return kino.lang === "en-US" ? "en-US" : "es-MX";
}

function preferred() {
  const chosen = String(setting("service", "openposterdb")).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SERVERS, chosen) ? chosen : "openposterdb";
}

function otherThan(name) {
  return name === "rpdb" ? "openposterdb" : "rpdb";
}

function serverKey() {
  return String(setting("key", "")).trim() || FREE_KEY;
}

// ---- the notes drawn on the poster (OpenPosterDB only: RatingPosterDB chooses its own) -----------------

const RATING_KEYS = ["mal", "lb", "rt", "mc", "rta", "tmdb", "trakt", "mdblist", "ebert"];
const RATING_MODES = {
  imdb: { order: "imdb", keep: ["imdb"], limit: 1 },
  imdbRt: { order: "imdb,rt", keep: ["imdb", "rt"], limit: 2 },
};

function ratingParams() {
  const mode = RATING_MODES[String(setting("ratings", "auto"))];
  if (!mode) return [];
  const exclude = RATING_KEYS.filter((k) => mode.keep.indexOf(k) === -1);
  return ["ratings_order=" + mode.order, "ratings_limit=" + mode.limit].concat(exclude.length ? ["ratings_exclude=" + exclude.join(",")] : []);
}

// `kind` is "poster" or "backdrop"; `idType` "imdb" or "tmdb"; for a TMDB id the type goes inside the value
// (`movie-603`, `series-1399`) because TMDB numbers films and series in two lists that collide.
function serverUrl(server, kind, idType, idValue) {
  const parts = [];
  if (server === "openposterdb" && kind === "poster") {
    parts.push("lang=" + lang());
    for (const p of ratingParams()) parts.push(p);
  }
  return (
    SERVERS[server] + "/" + encodeURIComponent(serverKey()) + "/" + idType + "/" + (kind === "poster" ? "poster-default" : "backdrop-default") +
    "/" + encodeURIComponent(idValue) + ".jpg" + (parts.length ? "?" + parts.join("&") : "")
  );
}

function tmdbValue(type, id) {
  return (type === "series" ? "series-" : "movie-") + id;
}

// ---- memory between sessions ------------------------------------------------------------------------------

function storeOk() {
  return !!kino.storage && typeof kino.storage.get === "function";
}

function recall(key) {
  if (!storeOk()) return null;
  try {
    const saved = JSON.parse(kino.storage.get(STORE_PREFIX + key) || "null");
    return saved && typeof saved === "object" ? saved : null;
  } catch {
    return null;
  }
}

function remember(key, value, ttlMs) {
  if (!storeOk()) return;
  try {
    kino.storage.set(STORE_PREFIX + key, JSON.stringify(value), { ttlMs });
  } catch (e) {
    // a full or missing store only means the answer is asked again next time
    log("no pude guardar: " + (e && e.message ? e.message : e));
  }
}

// ---- checks ----------------------------------------------------------------------------------------------

// Whether an image link really answers with an image. A HEAD is enough on both servers.
async function answers(url, ms) {
  if (ms < 300) return false;
  try {
    const r = await kino.fetch(url, { method: "HEAD", timeoutMs: ms });
    if (r.status < 200 || r.status >= 300) return false;
    const type = r.headers && (r.headers["content-type"] || r.headers["Content-Type"]);
    return !type || /^image\//i.test(String(type));
  } catch {
    return false;
  }
}

// TMDB is asked through Kino (its key, its cache and its limits). Kino gives `kino.tmdb` no timeout of its own
// short enough for a `meta` call, so each question races a timer and counts as "no answer" when it loses.
// A parameter given as null is left out (the image list must not be filtered by the person's language).
async function tmdb(path, params, ms) {
  if (typeof kino.tmdb !== "function") return null;
  const query = Object.assign({ language: lang() }, params || {});
  for (const name of Object.keys(query)) {
    if (query[name] === null || query[name] === undefined) delete query[name];
  }
  try {
    return await Promise.race([kino.tmdb(path, query), kino.sleep(Math.max(1, Math.min(ms, 5000))).then(() => null)]);
  } catch {
    return null;
  }
}

// The TMDB id of a title that came with only an IMDb id (cached: an id never changes).
async function tmdbIdOf(type, imdb, ms) {
  const saved = recall("map:" + imdb);
  if (saved && TMDB_ID.test(String(saved.id))) return String(saved.id);
  const data = await tmdb("/find/" + imdb, { external_source: "imdb_id" }, ms);
  if (!data) return null;
  const list = type === "series" ? data.tv_results : data.movie_results;
  const first = Array.isArray(list) && list.length ? list[0] : null;
  if (!first || !TMDB_ID.test(String(first.id))) return null;
  remember("map:" + imdb, { id: first.id }, 30 * 24 * 60 * 60 * 1000);
  return String(first.id);
}

// The best image TMDB has for a title in ANY language: the one Kino's own language filter missed.
async function tmdbImage(type, id, kind, ms) {
  const path = (type === "series" ? "/tv/" : "/movie/") + id + "/images";
  const data = await tmdb(path, { include_image_language: "es,en,null", language: null }, ms);
  const list = data && (kind === "poster" ? data.posters : data.backdrops);
  if (!Array.isArray(list) || !list.length) return null;
  const best = list
    .filter((i) => i && typeof i.file_path === "string" && /^\/[A-Za-z0-9._-]+$/.test(i.file_path))
    .sort((a, b) => Number(b.vote_average || 0) - Number(a.vote_average || 0))[0];
  return best ? TMDB_IMG[kind] + best.file_path : null;
}

// ---- the answer ----------------------------------------------------------------------------------------

function idsOf(query) {
  const ids = query && query.ids ? query.ids : {};
  const imdb = typeof ids.imdb === "string" && IMDB_ID.test(ids.imdb.trim()) ? ids.imdb.trim() : null;
  const tmdbValueRaw = ids.tmdb === undefined || ids.tmdb === null ? "" : String(ids.tmdb).trim();
  return { imdb, tmdb: TMDB_ID.test(tmdbValueRaw) ? tmdbValueRaw : null };
}

// One image of one kind: the preferred server and the other one are checked AT THE SAME TIME (the first in
// order that answers wins), and TMDB's list is only asked when neither has it.
async function findImage(type, ids, kind, left) {
  const order = [preferred(), otherThan(preferred())];
  const candidates = [];
  for (const server of order) {
    if (ids.tmdb) candidates.push({ server, url: serverUrl(server, kind, "tmdb", tmdbValue(type, ids.tmdb)) });
    // RatingPosterDB never gets an IMDb id (it would answer a generic picture for an unknown one).
    else if (ids.imdb && server === "openposterdb") candidates.push({ server, url: serverUrl(server, kind, "imdb", ids.imdb) });
  }
  if (candidates.length) {
    const verdicts = await Promise.all(candidates.map((c) => answers(c.url, Math.min(PROBE_MS, left()))));
    const winner = candidates.find((c, i) => verdicts[i]);
    if (winner) return { url: winner.url, from: winner.server };
  }
  if (ids.tmdb && left() >= 600) {
    const url = await tmdbImage(type, ids.tmdb, kind, Math.min(TMDB_MS, left()));
    if (url) return { url, from: "tmdb" };
  }
  return null;
}

// Kino only asks about a title another source listed, and a title with ids (never one without any).
export async function meta(query) {
  const type = query && query.type === "series" ? "series" : query && query.type === "movie" ? "movie" : null;
  if (!type) return null;
  const ids = idsOf(query);
  if (!ids.imdb && !ids.tmdb) return null;

  const wantBackdrop = isOn("backdrop", true);
  const cacheKey = [type, ids.tmdb || "-", ids.imdb || "-", preferred(), wantBackdrop ? "b" : "p", String(setting("ratings", "auto")), lang()].join(":");
  const saved = recall("hit:" + cacheKey);
  if (saved) return saved.none ? null : saved.answer;

  const started = Date.now();
  const left = () => Math.max(0, BUDGET_MS - (Date.now() - started));
  try {
    // RatingPosterDB and TMDB's image list need a TMDB id: turn an IMDb id into one once.
    if (!ids.tmdb && ids.imdb) ids.tmdb = await tmdbIdOf(type, ids.imdb, Math.min(TMDB_MS, left()));
    const [poster, backdrop] = await Promise.all([
      findImage(type, ids, "poster", left),
      wantBackdrop ? findImage(type, ids, "backdrop", left) : Promise.resolve(null),
    ]);
    const answer = {};
    if (poster) answer.poster = poster.url;
    if (backdrop) answer.backdrop = backdrop.url;
    if (!answer.poster && !answer.backdrop) {
      remember("hit:" + cacheKey, { none: true }, MISS_TTL_MS);
      return null;
    }
    log("relleno " + Object.keys(answer).join("+") + " de " + type + " " + (ids.tmdb || ids.imdb) + " desde " + [poster && poster.from, backdrop && backdrop.from].filter(Boolean).join("/"));
    remember("hit:" + cacheKey, { answer }, HIT_TTL_MS);
    return answer;
  } catch (e) {
    // Never throw out of meta: a plugin that errors three times in a row is switched off.
    log("meta: " + (e && e.message ? e.message : e));
    return null;
  }
}

// ---- the settings form -------------------------------------------------------------------------------

const PROBE_MOVIE = { imdb: "tt0133093", tmdb: "603" };

async function probeAll(ms) {
  const checks = await Promise.all([
    answers(serverUrl("openposterdb", "poster", "tmdb", tmdbValue("movie", PROBE_MOVIE.tmdb)), ms),
    answers(serverUrl("rpdb", "poster", "tmdb", tmdbValue("movie", PROBE_MOVIE.tmdb)), ms),
    answers(serverUrl("openposterdb", "backdrop", "tmdb", tmdbValue("movie", PROBE_MOVIE.tmdb)), ms),
    tmdb("/movie/" + PROBE_MOVIE.tmdb + "/images", { include_image_language: "es,en,null", language: null }, ms).then((d) => !!(d && Array.isArray(d.posters))),
  ]);
  return [
    "OpenPosterDB " + (checks[0] ? "✓" : t("down")),
    "RatingPosterDB " + (checks[1] ? "✓" : t("down")),
    checks[2] ? t("backdropOk") : t("backdropNo"),
    checks[3] ? t("tmdbOk") : t("tmdbNo"),
  ].join(" · ");
}

// Kino gives the form 10 s in all: the checks go with less patience than in a real call.
export async function settingsStatus() {
  try {
    return { serverStatus: (await probeAll(2500)).slice(0, 200) };
  } catch (e) {
    log("estado: " + (e && e.message ? e.message : e));
    return { serverStatus: t("cantCheck") };
  }
}

export async function action(key) {
  if (key !== "testServer") return { message: "?" };
  try {
    return { message: (await probeAll(6000)).slice(0, 300) };
  } catch (e) {
    return { message: t("cantCheck") };
  }
}

// Runs before saving: a key with a space is refused by both servers with a message that says nothing.
export async function validateSettings(values) {
  const key = values && typeof values.key === "string" ? values.key.trim() : "";
  return /\s/.test(key) ? { key: t("noClave") } : null;
}
