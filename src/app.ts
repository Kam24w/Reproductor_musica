import { Track, Playlist, PlaylistNode, MusicPlayer } from "./models.js";
import { UI_TEXT, uiFormat } from "./texts.js";

// ═══════════════════════════════════════════════════════════
// CONTROLADOR UI — Melodify
// ═══════════════════════════════════════════════════════════

const player = new MusicPlayer();

// ── DOM refs ─────────────────────────────────────────────
const sidebarPlaylistsEl   = document.getElementById("sidebar-playlists")!;
const mainEl               = document.getElementById("main")!;
const footerEl             = document.getElementById("footer")!;
const toastEl              = document.getElementById("toast")!;
const modalEl              = document.getElementById("modal")!;
const modalOverlayEl       = document.getElementById("modal-overlay")!;
const modalTitleInput      = document.getElementById("modal-title") as HTMLInputElement;
const modalArtistInput     = document.getElementById("modal-artist") as HTMLInputElement;
const modalDurationInput   = document.getElementById("modal-duration") as HTMLInputElement;
const modalPositionInput   = document.getElementById("modal-position") as HTMLInputElement;
const modalSubmitBtn       = document.getElementById("modal-submit")!;
const modalCancelBtn       = document.getElementById("modal-cancel")!;
const modalCancelBtn2      = document.getElementById("modal-cancel-2") as HTMLButtonElement | null;
const newPlaylistInput     = document.getElementById("new-playlist-input") as HTMLInputElement;
const newPlaylistBtn       = document.getElementById("new-playlist-btn")!;
const itunesSearchLinkEl   = document.getElementById("itunes-search-link") as HTMLAnchorElement | null;
const homeNavEl            = document.getElementById("home-nav") as HTMLAnchorElement | null;

// ── Progreso ──────────────────────────────────────────────
let progressInterval: number | null = null;
let currentProgress = 0;
let currentTrackDuration = 0;
let isQueuePanelOpen = false;
const audioPlayer = new Audio();
audioPlayer.preload = "metadata";
let desiredVolume = 0.75;
audioPlayer.volume = desiredVolume;
let viewMode: "home" | "playlist" = "home";
let homeSearchQuery = "";
const favoriteTrackKeys = new Set<string>();
const FAVORITES_PLAYLIST_NAME = UI_TEXT.playlist.favoritesName;
const FAVORITES_STORAGE_PREFIX = "melodify-favorites:";
let liveItunesQuery = "";
let liveItunesTracks: Track[] = [];
let liveItunesCover = "";
let liveItunesLoading = false;
let liveItunesTimer: number | null = null;
let djModeEnabled = false;
let djTransitionToken = 0;
const DJ_STYLE_PLAYLIST_ORDER = ["Pop Hits", "Workout Mix", "Chill Vibes", "Latin Flow", "Rock Classics", "Indie Pop"];
let searchMenuOutsideHandler: ((event: MouseEvent) => void) | null = null;
let searchMenuKeyHandler: ((event: KeyboardEvent) => void) | null = null;
let addSongSearchQuery = "";
let addSongSearchLoading = false;
let addSongSearchTimer: number | null = null;
let addSongSearchRequestId = 0;

type AddSongSuggestion = {
  track: Track;
  cover: string;
  sourceLabel: string;
};

type AddSongRecommendationGroup = {
  title: string;
  sourceLabel: string;
  items: AddSongSuggestion[];
};

let addSongSearchResults: AddSongSuggestion[] = [];
let addSongSearchCover = "";
let addSongRecommendationGroups: AddSongRecommendationGroup[] = [];

type AccountTheme = "dark" | "light";
type AccountProfile = { name: string; theme: AccountTheme };
let currentAccount: AccountProfile | null = null;
const ACCOUNT_STORAGE_KEY = "melodify-account";
let accountMenuOutsideHandler: ((event: MouseEvent) => void) | null = null;
let accountMenuKeyHandler: ((event: KeyboardEvent) => void) | null = null;

const ITUNES_API_BASE = "https://itunes.apple.com/search";

interface ItunesSongResult {
  trackName?: string;
  artistName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
}

interface ItunesSearchResponse {
  resultCount?: number;
  results?: ItunesSongResult[];
}

// ═══════════════════════════════════════════════════════════
// DATOS DE EJEMPLO
// ═══════════════════════════════════════════════════════════
async function initSampleData(): Promise<void> {
  try {
    ensureFavoritesPlaylist();

    const [pop, workout, chill, latin, rock, indie] = await Promise.all([
      fetchItunesSongs("top pop hits", 12),
      fetchItunesSongs("workout mix", 12),
      fetchItunesSongs("chill vibes", 12),
      fetchItunesSongs("latin hits", 12),
      fetchItunesSongs("rock classics", 12),
      fetchItunesSongs("indie pop", 12)
    ]);

    buildPlaylistFromItunes("Pop Hits", "#6B3FA0", pop);
    buildPlaylistFromItunes("Workout Mix", "#C0392B", workout);
    buildPlaylistFromItunes("Chill Vibes", "#1A6B8A", chill);
    buildPlaylistFromItunes("Latin Flow", "#E67E22", latin);
    buildPlaylistFromItunes("Rock Classics", "#8E44AD", rock);
    buildPlaylistFromItunes("Indie Pop", "#16A085", indie);

    player.currentPlaylist = null;
    viewMode = "home";

    showToast(UI_TEXT.toast.initialPlaylistsLoaded);
  } catch (_err) {
    showToast(UI_TEXT.toast.initialPlaylistsError, "error");
  }
}

function buildPlaylistFromItunes(name: string, color: string, data: { tracks: Track[]; cover: string }): void {
  const playlist = player.createPlaylist(name, data.cover, color);
  data.tracks.forEach(track => playlist.addTrackToEnd(track));
}

async function importItunesPlaylistFromQuery(query: string): Promise<void> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return;

  const playlistName = `Melodify: ${cleanQuery}`;
  const colors = ["#6B3FA0", "#C0392B", "#1A6B8A", "#2E7D32", "#E67E22", "#16A085", "#8E44AD", "#D35400"];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const existing = player.playlists.find(p => p.name === playlistName);
  if (existing) {
    player.removePlaylist(playlistName);
  }

  const data = await fetchItunesSongs(cleanQuery, 12);
  buildPlaylistFromItunes(playlistName, color, data);
  player.switchPlaylist(playlistName);
  stopProgress();
  currentProgress = 0;
  renderAll();
  showToast(uiFormat.searchResultsLoaded(cleanQuery));
}

async function fetchItunesSongs(term: string, limit = 8): Promise<{ tracks: Track[]; cover: string }> {
  const url = new URL(ITUNES_API_BASE);
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("country", "MX");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Melodify respondió con ${response.status}`);
  }

  const payload = (await response.json()) as ItunesSearchResponse;
  const results = Array.isArray(payload.results) ? payload.results : [];

  const tracks = results
    .filter(r => r.trackName && r.artistName && r.previewUrl)
    .map(r => {
      const duration = Math.max(1, Math.round((r.trackTimeMillis ?? 180000) / 1000));
      return new Track(r.trackName!, r.artistName!, duration, r.previewUrl ?? "");
    });

  if (tracks.length === 0) {
    throw new Error("Melodify did not return songs.");
  }

  const cover = normalizeItunesArtwork(results[0]?.artworkUrl100 ?? "");
  return { tracks, cover };
}

function normalizeItunesArtwork(artworkUrl: string): string {
  if (!artworkUrl) return "";
  return artworkUrl.replace(/100x100bb\.jpg$/i, "600x600bb.jpg");
}

function makeAddSongSuggestion(track: Track, cover: string, sourceLabel: string): AddSongSuggestion {
  return { track, cover, sourceLabel };
}

function inferRecommendationSeedFromPlaylist(pl: Playlist | null): { title: string; query: string }[] {
  const seeds: { title: string; query: string }[] = [];
  if (!pl) return seeds;

  const name = normalizeSearchText(pl.name);
  const addSeed = (title: string, query: string) => {
    if (!query.trim()) return;
    const normalizedQuery = normalizeSearchText(query);
    if (seeds.some(seed => normalizeSearchText(seed.query) === normalizedQuery)) return;
    seeds.push({ title, query });
  };

  if (name.includes("pop")) addSeed(UI_TEXT.common.byGenre, "pop hits");
  else if (name.includes("rock")) addSeed(UI_TEXT.common.byGenre, "rock classics");
  else if (name.includes("latin") || name.includes("latino")) addSeed(UI_TEXT.common.byGenre, "latin hits");
  else if (name.includes("chill") || name.includes("relax")) addSeed(UI_TEXT.common.byGenre, "chill vibes");
  else if (name.includes("workout") || name.includes("gym") || name.includes("fitness")) addSeed(UI_TEXT.common.byGenre, "workout mix");
  else if (name.includes("indie")) addSeed(UI_TEXT.common.byGenre, "indie pop");
  else if (name.includes("dance") || name.includes("party")) addSeed(UI_TEXT.common.byGenre, "dance hits");

  const anchorTrack = pl.current?.track ?? pl.getTracks()[0] ?? null;
  if (anchorTrack?.artist) {
    addSeed(`Por cantante · ${anchorTrack.artist}`, anchorTrack.artist);
  }
  if (anchorTrack?.artist && anchorTrack?.title) {
    addSeed(UI_TEXT.common.similarToCurrentSong, `${anchorTrack.artist} ${anchorTrack.title}`);
  }

  if (seeds.length === 0) {
    addSeed("Sugerencias", "top pop hits");
    addSeed("Sugerencias", "chill vibes");
  }

  return seeds.slice(0, 3);
}

function dedupeAddSongSuggestions(items: AddSongSuggestion[]): AddSongSuggestion[] {
  const seen = new Set<string>();
  const unique: AddSongSuggestion[] = [];
  for (const item of items) {
    const key = trackKey(item.track);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

async function loadAddSongRecommendations(): Promise<void> {
  const seeds = inferRecommendationSeedFromPlaylist(player.currentPlaylist);
  if (seeds.length === 0) {
    addSongRecommendationGroups = [];
    return;
  }

  const groups = await Promise.all(seeds.map(async seed => {
    try {
      const data = await fetchItunesSongs(seed.query, 6);
      const items = dedupeAddSongSuggestions(data.tracks.map(track => makeAddSongSuggestion(track, data.cover, seed.title)));
      return { title: seed.title, sourceLabel: seed.query, items } satisfies AddSongRecommendationGroup;
    } catch (_err) {
      return { title: seed.title, sourceLabel: seed.query, items: [] } satisfies AddSongRecommendationGroup;
    }
  }));

  addSongRecommendationGroups = groups.filter(group => group.items.length > 0);
}

function renderAddSongSuggestionList(items: AddSongSuggestion[], emptyMessage: string, groupKey: string): string {
  if (items.length === 0) {
    return `<div class="add-song-empty">${escHtml(emptyMessage)}</div>`;
  }

  return items.map((item, index) => {
    const key = `${groupKey}-${index}`;
    return `
      <article class="add-song-row" data-add-song-key="${escHtml(key)}" data-add-song-source="${escHtml(item.sourceLabel)}">
        <div class="add-song-cover" style="${item.cover ? `background-image:url('${item.cover}'); background-size:cover; background-position:center;` : `background:var(--bg-hover);`}">
          ${!item.cover ? musicNoteIcon(22) : ""}
        </div>
        <div class="add-song-copy">
          <strong>${escHtml(item.track.title)}</strong>
          <span>${escHtml(item.track.artist)} · ${escHtml(item.sourceLabel)}</span>
        </div>
        <button class="add-song-add-btn" type="button" data-add-song-list="${escHtml(groupKey)}" data-add-song-index="${index}">${UI_TEXT.addSong.addButton}</button>
      </article>
    `;
  }).join("");
}

function renderAddSongModal(): void {
  const keepSearchFocus = document.activeElement?.id === "add-song-search-input";

  const searchState = addSongSearchLoading
    ? `<div class="add-song-empty">${UI_TEXT.addSong.loadingSongs}</div>`
    : addSongSearchQuery.trim() && addSongSearchResults.length === 0
      ? `<div class="add-song-empty">${UI_TEXT.addSong.noMatchesPrefix} "${escHtml(addSongSearchQuery.trim())}".</div>`
      : addSongSearchQuery.trim()
        ? renderAddSongSuggestionList(addSongSearchResults, UI_TEXT.addSong.noResultsYet, "search")
        : `<div class="add-song-empty">${UI_TEXT.addSong.writeToSearch}</div>`;

  const recommendationMarkup = addSongRecommendationGroups.length > 0
    ? addSongRecommendationGroups.map((group, groupIndex) => `
        <section class="add-song-group">
          <div class="add-song-group-head">
            <div>
              <h3>${escHtml(group.title)}</h3>
              <span>${escHtml(group.sourceLabel)}</span>
            </div>
          </div>
          <div class="add-song-list">
            ${renderAddSongSuggestionList(group.items, UI_TEXT.addSong.noRecommendations, `rec-${groupIndex}`)}
          </div>
        </section>
      `).join("")
    : `<div class="add-song-empty">${UI_TEXT.addSong.loadingRecommendations}</div>`;

  const modalIsOpen = modalEl.classList.contains("open");
  modalEl.className = modalIsOpen ? "modal add-song-modal open" : "modal add-song-modal";
  modalEl.innerHTML = `
    <div class="add-song-shell" role="dialog" aria-modal="true" aria-labelledby="add-song-title">
      <div class="modal-header add-song-header">
        <div>
          <div class="add-song-kicker">${UI_TEXT.addSong.titleKicker}</div>
          <h2 id="add-song-title">${UI_TEXT.addSong.title}</h2>
        </div>
        <button id="add-song-close" class="modal-close-btn" type="button" aria-label="${UI_TEXT.common.close}">${closeIcon(18)}</button>
      </div>

      <p class="add-song-copy">${UI_TEXT.addSong.modalCopy}</p>

      <div class="home-search-shell add-song-search-shell">
        ${searchIcon(18)}
        <input type="text" id="add-song-search-input" class="home-search-input" placeholder="${UI_TEXT.addSong.searchPlaceholder}" value="${escHtml(addSongSearchQuery)}" autocomplete="off" />
        <button type="button" id="add-song-search-btn" class="add-song-search-btn">${UI_TEXT.addSong.searchButton}</button>
      </div>

      <div class="add-song-sections">
        <section class="add-song-section">
          <div class="add-song-group-head">
            <div>
              <h3>${UI_TEXT.addSong.resultsTitle}</h3>
              <span>${addSongSearchQuery.trim() ? escHtml(addSongSearchQuery.trim()) : UI_TEXT.addSong.startTyping}</span>
            </div>
          </div>
          <div class="add-song-list" id="add-song-search-results">
            ${searchState}
          </div>
        </section>

        <section class="add-song-section">
          <div class="add-song-group-head">
            <div>
              <h3>${UI_TEXT.addSong.recommendationsTitle}</h3>
              <span>${UI_TEXT.addSong.recommendationsCopy}</span>
            </div>
          </div>
          <div class="add-song-recommendations" id="add-song-recommendations">
            ${recommendationMarkup}
          </div>
        </section>
      </div>
    </div>
  `;

  const searchInput = document.getElementById("add-song-search-input") as HTMLInputElement | null;
  const searchBtn = document.getElementById("add-song-search-btn") as HTMLButtonElement | null;
  const closeBtn = document.getElementById("add-song-close") as HTMLButtonElement | null;

  searchInput?.addEventListener("input", () => {
    scheduleAddSongSearch(searchInput.value);
  });

  searchBtn?.addEventListener("click", () => {
    scheduleAddSongSearch(searchInput?.value ?? "");
  });

  searchInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      scheduleAddSongSearch(searchInput.value);
    }
  });

  closeBtn?.addEventListener("click", closeModal);
  renderAddSongActionHandlers();

  modalEl.style.width = "min(920px, 96vw)";
  modalEl.style.maxHeight = "calc(100vh - 32px)";
  modalEl.style.overflowX = "hidden";
  modalEl.style.overflowY = "auto";

  if (keepSearchFocus && searchInput) {
    window.requestAnimationFrame(() => {
      if (!modalEl.classList.contains("open")) return;
      searchInput.focus();
      const cursor = searchInput.value.length;
      searchInput.setSelectionRange(cursor, cursor);
    });
  }
}

function renderAddSongActionHandlers(): void {
  modalEl.querySelectorAll<HTMLElement>("[data-add-song-list]").forEach(row => {
    row.addEventListener("click", () => {
      const list = row.dataset.addSongList ?? "";
      const index = Number(row.dataset.addSongIndex ?? "-1");
      if (Number.isNaN(index) || index < 0) return;
      if (list === "search") {
        const suggestion = addSongSearchResults[index];
        if (suggestion) addSuggestionToCurrentPlaylist(suggestion.track);
        return;
      }

      const recMatch = list.match(/^rec-(\d+)$/);
      if (!recMatch) return;
      const group = addSongRecommendationGroups[Number(recMatch[1])];
      const suggestion = group?.items[index];
      if (suggestion) addSuggestionToCurrentPlaylist(suggestion.track);
    });
  });
}

function addSuggestionToCurrentPlaylist(track: Track): void {
  const pl = player.currentPlaylist;
  if (!pl) {
    showToast(UI_TEXT.addSong.selectPlaylistFirst, "error");
    return;
  }

  pl.addTrackToEnd(new Track(track.title, track.artist, track.duration, track.previewUrl));
  showToast(uiFormat.trackAddedToPlaylist(track.title, pl.name));
  closeModal();
  renderAll();
}

function scheduleAddSongSearch(query: string): void {
  if (addSongSearchTimer !== null) {
    clearTimeout(addSongSearchTimer);
    addSongSearchTimer = null;
  }

  addSongSearchQuery = query;
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    addSongSearchResults = [];
    addSongSearchCover = "";
    addSongSearchLoading = false;
    if (modalEl.classList.contains("open")) {
      renderAddSongModal();
    }
    return;
  }

  addSongSearchLoading = true;

  const requestId = ++addSongSearchRequestId;
  addSongSearchTimer = window.setTimeout(async () => {
    try {
      const data = await fetchItunesSongs(cleanQuery, 10);
      if (requestId !== addSongSearchRequestId) return;
      addSongSearchResults = data.tracks.map(track => makeAddSongSuggestion(track, data.cover, cleanQuery));
      addSongSearchCover = data.cover;
    } catch (_err) {
      if (requestId !== addSongSearchRequestId) return;
      addSongSearchResults = [];
      addSongSearchCover = "";
    } finally {
      if (requestId !== addSongSearchRequestId) return;
      addSongSearchLoading = false;
      if (modalEl.classList.contains("open")) {
        renderAddSongModal();
      }
    }
  }, 300);
}

function scheduleLiveItunesSearch(query: string): void {
  if (liveItunesTimer !== null) {
    clearTimeout(liveItunesTimer);
    liveItunesTimer = null;
  }

  const cleanQuery = query.trim();
  if (!cleanQuery) {
    liveItunesQuery = "";
    liveItunesTracks = [];
    liveItunesCover = "";
    liveItunesLoading = false;
    renderHomeContent();
    return;
  }

  liveItunesQuery = cleanQuery;
  liveItunesTracks = [];
  liveItunesCover = "";
  liveItunesLoading = true;
  renderHomeContent();

  liveItunesTimer = window.setTimeout(async () => {
    try {
      const data = await fetchItunesSongs(cleanQuery, 8);
      liveItunesTracks = data.tracks;
      liveItunesCover = data.cover;
    } catch (_err) {
      liveItunesTracks = [];
      liveItunesCover = "";
    } finally {
      liveItunesLoading = false;
      renderHomeContent();
    }
  }, 300);
}

function trackKey(track: Track): string {
  return `${track.title}||${track.artist}||${track.previewUrl}`.toLowerCase();
}

function getFavoritesPlaylist(): Playlist | null {
  return player.playlists.find(pl => pl.name === FAVORITES_PLAYLIST_NAME) ?? null;
}

function ensureFavoritesPlaylist(): Playlist {
  const existing = getFavoritesPlaylist();
  if (existing) return existing;
  return player.createPlaylist(FAVORITES_PLAYLIST_NAME, "", "#1DB954");
}

function isTrackFavorite(track: Track | null): boolean {
  return !!track && favoriteTrackKeys.has(trackKey(track));
}

function toggleTrackFavorite(track: Track): void {
  const favoritesPlaylist = ensureFavoritesPlaylist();
  const key = trackKey(track);
  if (favoriteTrackKeys.has(key)) {
    favoriteTrackKeys.delete(key);
    const favoriteTrack = favoritesPlaylist.getTracks().find(t => trackKey(t) === key);
    if (favoriteTrack) {
      favoritesPlaylist.removeTrack(favoriteTrack.title);
    }
    showToast(uiFormat.favoriteRemoved(track.title));
  } else {
    favoriteTrackKeys.add(key);
    const alreadyInFavorites = favoritesPlaylist.getTracks().some(t => trackKey(t) === key);
    if (!alreadyInFavorites) {
      favoritesPlaylist.addTrackToEnd(new Track(track.title, track.artist, track.duration, track.previewUrl));
    }
    showToast(uiFormat.favoriteAdded(track.title));
  }
  saveFavoriteKeysForCurrentAccount();
  renderAll();
}

function getFavoritesStorageKeyForAccount(name: string): string {
  return `${FAVORITES_STORAGE_PREFIX}${normalizeSearchText(name)}`;
}

function saveFavoriteKeysForCurrentAccount(): void {
  if (!currentAccount) return;
  try {
    window.localStorage.setItem(
      getFavoritesStorageKeyForAccount(currentAccount.name),
      JSON.stringify(Array.from(favoriteTrackKeys))
    );
  } catch (_err) {
    // Ignore storage failures in restricted environments.
  }
}

function loadFavoriteKeysForCurrentAccount(): void {
  favoriteTrackKeys.clear();
  if (!currentAccount) return;

  try {
    const raw = window.localStorage.getItem(getFavoritesStorageKeyForAccount(currentAccount.name));
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach(value => {
      if (typeof value === "string" && value.trim()) {
        favoriteTrackKeys.add(value);
      }
    });
  } catch (_err) {
    // Ignore malformed storage values.
  }
}

function syncFavoritesPlaylistFromCache(): void {
  const favoritesPlaylist = ensureFavoritesPlaylist();

  while (favoritesPlaylist.head) {
    favoritesPlaylist.removeTrack(favoritesPlaylist.head.track.title);
  }

  const added = new Set<string>();
  player.playlists
    .filter(pl => pl.name !== FAVORITES_PLAYLIST_NAME)
    .forEach(pl => {
      pl.getTracks().forEach(track => {
        const key = trackKey(track);
        if (!favoriteTrackKeys.has(key) || added.has(key)) return;
        favoritesPlaylist.addTrackToEnd(new Track(track.title, track.artist, track.duration, track.previewUrl));
        added.add(key);
      });
    });
}

function clearProfileSessionState(): void {
  closeAccountMenu();
  currentAccount = null;
  favoriteTrackKeys.clear();
  applyAccountTheme("dark");
  syncFavoritesPlaylistFromCache();
  renderAll();
}

function getFavoriteEntries(): HomeSearchResult[] {
  const favoritesPlaylist = getFavoritesPlaylist();
  if (!favoritesPlaylist) return [];
  return favoritesPlaylist.getTracks().map(track => ({ playlist: favoritesPlaylist, track }));
}

function getCurrentTrack(): Track | null {
  return player.currentPlaylist?.current?.track ?? null;
}

function isAudioPreviewTrack(track: Track | null): boolean {
  return !!track?.previewUrl;
}

function formatTrackDuration(track: Track | null): string {
  if (!track) return "0:00";
  if (currentTrackDuration > 0) return formatTime(currentTrackDuration);
  return track.formattedDuration();
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function ensurePlaylistCurrentNode(pl: Playlist): PlaylistNode | null {
  if (!pl.current) pl.current = pl.head;
  return pl.current;
}

function getDjOrderedPlaylists(): Playlist[] {
  const candidates = player.playlists.filter(pl => pl.name !== FAVORITES_PLAYLIST_NAME && pl.size > 0);
  const orderMap = new Map(DJ_STYLE_PLAYLIST_ORDER.map((name, index) => [name, index]));
  return [...candidates].sort((a, b) => {
    const ai = orderMap.has(a.name) ? orderMap.get(a.name)! : Number.MAX_SAFE_INTEGER;
    const bi = orderMap.has(b.name) ? orderMap.get(b.name)! : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

function pickNextDjPlaylist(currentName: string | null): Playlist | null {
  const ordered = getDjOrderedPlaylists();
  if (ordered.length === 0) return null;
  if (!currentName) return ordered[0];
  const idx = ordered.findIndex(pl => pl.name === currentName);
  if (idx === -1) return ordered[0];
  return ordered[(idx + 1) % ordered.length];
}

function animateAudioVolume(from: number, to: number, durationMs: number, token: number): Promise<void> {
  if (durationMs <= 0) {
    audioPlayer.volume = Math.max(0, Math.min(1, to));
    return Promise.resolve();
  }

  const start = performance.now();
  return new Promise(resolve => {
    const tick = () => {
      if (token !== djTransitionToken) {
        resolve();
        return;
      }
      const now = performance.now();
      const progress = Math.max(0, Math.min(1, (now - start) / durationMs));
      const value = from + (to - from) * progress;
      audioPlayer.volume = Math.max(0, Math.min(1, value));
      if (progress >= 1) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
}

async function playDjTransitionToTrack(track: Track): Promise<boolean> {
  if (!track.previewUrl) return false;

  const token = ++djTransitionToken;
  const fadeOutFrom = audioPlayer.paused ? 0 : audioPlayer.volume;
  if (fadeOutFrom > 0.01) {
    await animateAudioVolume(fadeOutFrom, 0, 550, token);
  }

  if (token !== djTransitionToken) return true;

  audioPlayer.pause();
  audioPlayer.src = track.previewUrl;
  audioPlayer.load();
  audioPlayer.currentTime = 0;
  audioPlayer.volume = 0;

  try {
    await audioPlayer.play();
  } catch (_err) {
    audioPlayer.volume = desiredVolume;
    return false;
  }

  await animateAudioVolume(0, desiredVolume, 1000, token);
  return true;
}

function applyDjStyleShift(showMessage = false): Track | null {
  const currentName = player.currentPlaylist?.name ?? null;
  const targetPlaylist = pickNextDjPlaylist(currentName);
  if (!targetPlaylist) return null;

  if (!player.switchPlaylist(targetPlaylist.name)) return null;
  const node = ensurePlaylistCurrentNode(targetPlaylist);
  if (!node) return null;

  if (showMessage) {
    showToast(uiFormat.djStyleChanged(targetPlaylist.name));
  }
  return node.track;
}

async function handleDjSkipAdvance(): Promise<void> {
  const track = applyDjStyleShift(true);
  if (!track) {
    showToast(UI_TEXT.player.djNoPlaylist, "error");
    return;
  }

  player.isPlaying = true;
  currentProgress = 0;
  currentTrackDuration = track.duration;

  const transitioned = await playDjTransitionToTrack(track);
  if (!transitioned) {
    void preparePreviewPlayback(track, true);
  }
  renderAll();
}

async function handleDjTrackEnded(): Promise<boolean> {
  const currentPlaylist = player.currentPlaylist;
  if (!currentPlaylist) return false;

  let nextTrack = player.next();
  if (!nextTrack) {
    const styleTrack = applyDjStyleShift(false);
    if (!styleTrack) return false;
    nextTrack = styleTrack;
  }

  player.isPlaying = true;
  currentProgress = 0;
  currentTrackDuration = nextTrack.duration;

  const transitioned = await playDjTransitionToTrack(nextTrack);
  if (!transitioned) {
    void preparePreviewPlayback(nextTrack, true);
  }
  renderAll();
  return true;
}

async function preparePreviewPlayback(track: Track, restart = false): Promise<boolean> {
  if (!track.previewUrl) {
    showToast(UI_TEXT.player.previewMissing, "error");
    return false;
  }

  player.isPlaying = true;
  if (restart) {
    currentProgress = 0;
    audioPlayer.currentTime = 0;
  }
  currentTrackDuration = track.duration;

  if (audioPlayer.src !== track.previewUrl) {
    audioPlayer.src = track.previewUrl;
    audioPlayer.load();
  }

  try {
    await audioPlayer.play();
  } catch (_err) {
    player.isPlaying = false;
    showToast(UI_TEXT.player.previewError, "error");
    return false;
  }

  renderFooter();
  return true;
}

function syncFooterProgressUI(): void {
  const fill = document.querySelector<HTMLElement>(".footer-bar-fill");
  const timeEl = document.querySelector<HTMLElement>(".footer-time");
  if (fill && currentTrackDuration > 0) {
    fill.style.width = `${(currentProgress / currentTrackDuration) * 100}%`;
  }
  if (timeEl) {
    timeEl.textContent = formatTime(currentProgress);
  }
}

audioPlayer.addEventListener("timeupdate", () => {
  if (!player.isPlaying) return;
  if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration <= 0) return;
  currentProgress = Math.floor(audioPlayer.currentTime);
  currentTrackDuration = Math.floor(audioPlayer.duration);
  syncFooterProgressUI();
});

audioPlayer.addEventListener("loadedmetadata", () => {
  if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration <= 0) return;
  currentTrackDuration = Math.floor(audioPlayer.duration);
  renderFooter();
});

audioPlayer.addEventListener("ended", () => {
  void (async () => {
    if (djModeEnabled) {
      const handled = await handleDjTrackEnded();
      if (handled) return;
    }

    const next = player.next();
    currentProgress = 0;
    if (next && player.isPlaying) {
      startProgress();
    } else {
      player.isPlaying = false;
      stopProgress();
    }
    renderAll();
  })();
});

// ═══════════════════════════════════════════════════════════
// RENDER PRINCIPAL
// ═══════════════════════════════════════════════════════════

function renderAll(): void {
  renderSidebar();
  renderMain();
  renderFooter();
  renderAccountChip();
}

function applyAccountTheme(theme: AccountTheme): void {
  document.body.classList.toggle("theme-light", theme === "light");
}

function loadStoredAccount(): AccountProfile | null {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AccountProfile>;
    if (typeof parsed?.name !== "string" || !parsed.name.trim()) return null;

    const theme: AccountTheme = parsed.theme === "light" ? "light" : "dark";
    return { name: parsed.name.trim(), theme };
  } catch (_err) {
    return null;
  }
}

function saveCurrentAccount(): void {
  if (!currentAccount) return;

  try {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(currentAccount));
  } catch (_err) {
    // Ignore storage failures in restricted environments.
  }
}

function clearStoredAccount(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  } catch (_err) {
    // Ignore storage failures in restricted environments.
  }
}

function ensureAccountChipEl(): HTMLButtonElement {
  let chip = document.getElementById("account-chip") as HTMLButtonElement | null;
  if (chip) return chip;

  chip = document.createElement("button");
  chip.id = "account-chip";
  chip.className = "account-chip";
  chip.type = "button";
  chip.setAttribute("aria-haspopup", "menu");
  chip.setAttribute("aria-expanded", "false");
  chip.addEventListener("click", () => {
    if (!currentAccount) {
      void promptAccountSetup();
      return;
    }

    toggleAccountMenu();
  });
  document.body.appendChild(chip);
  return chip;
}

function renderAccountChip(): void {
  const chip = ensureAccountChipEl();
  if (!currentAccount) {
    chip.textContent = UI_TEXT.account.defaultChip;
    chip.removeAttribute("title");
    return;
  }

  const parts = currentAccount.name.split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : currentAccount.name.slice(0, 2).toUpperCase();

  chip.textContent = initials;
  chip.title = currentAccount.name;
  chip.setAttribute("aria-label", uiFormat.accountChipTitle(currentAccount.name));
}

function ensureAccountMenuEl(): HTMLElement {
  let menu = document.getElementById("account-menu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "account-menu";
  menu.className = "account-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <div class="account-menu-header">
      <div>
        <div class="account-menu-kicker">${UI_TEXT.account.settingsKicker}</div>
        <div class="account-menu-title">${UI_TEXT.account.profileTitle}</div>
      </div>
      <button id="account-menu-close" class="account-menu-close" type="button" aria-label="${UI_TEXT.account.close}">${closeIcon(16)}</button>
    </div>

    <label class="account-label" for="account-menu-name">${UI_TEXT.account.nameLabel}</label>
    <input id="account-menu-name" class="account-input" type="text" maxlength="28" autocomplete="off" />

    <label class="account-label">${UI_TEXT.account.themeLabel}</label>
    <div class="account-theme-picker" id="account-menu-theme-picker">
      <button type="button" class="account-theme-option" data-theme="dark">${UI_TEXT.account.darkTheme}</button>
      <button type="button" class="account-theme-option" data-theme="light">${UI_TEXT.account.lightTheme}</button>
    </div>

    <div class="account-menu-error" aria-live="polite"></div>

    <div class="account-menu-actions">
      <button id="account-menu-cancel" class="account-menu-secondary" type="button">${UI_TEXT.account.close}</button>
      <button id="account-menu-save" class="account-menu-primary" type="button">${UI_TEXT.account.saveChanges}</button>
    </div>

    <button id="account-menu-logout" class="account-menu-secondary" type="button">${UI_TEXT.account.logout}</button>
  `;
  document.body.appendChild(menu);

  const closeMenu = () => closeAccountMenu();
  const saveBtn = menu.querySelector("#account-menu-save") as HTMLButtonElement;
  const cancelBtn = menu.querySelector("#account-menu-cancel") as HTMLButtonElement;
  const closeBtn = menu.querySelector("#account-menu-close") as HTMLButtonElement;
  const logoutBtn = menu.querySelector("#account-menu-logout") as HTMLButtonElement;
  const themePicker = menu.querySelector("#account-menu-theme-picker") as HTMLDivElement;

  const setThemeSelection = (theme: AccountTheme) => {
    themePicker.querySelectorAll<HTMLButtonElement>(".account-theme-option").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });
  };

  themePicker.querySelectorAll<HTMLButtonElement>(".account-theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
      setThemeSelection(btn.dataset.theme === "light" ? "light" : "dark");
    });
  });

  saveBtn.addEventListener("click", () => {
    const previousAccountName = currentAccount?.name ?? null;
    const nameInput = menu!.querySelector("#account-menu-name") as HTMLInputElement;
    const error = menu!.querySelector<HTMLElement>(".account-menu-error");
    const activeTheme = themePicker.querySelector<HTMLButtonElement>(".account-theme-option.active")?.dataset.theme === "light"
      ? "light"
      : "dark";
    const name = nameInput.value.trim();

    if (!name) {
      if (error) error.textContent = UI_TEXT.account.saveNameRequired;
      nameInput.focus();
      return;
    }

    currentAccount = { name, theme: activeTheme };
    saveCurrentAccount();
    if (previousAccountName && normalizeSearchText(previousAccountName) !== normalizeSearchText(name)) {
      saveFavoriteKeysForCurrentAccount();
    }
    loadFavoriteKeysForCurrentAccount();
    syncFavoritesPlaylistFromCache();
    applyAccountTheme(activeTheme);
    renderAccountChip();
    closeMenu();
    showToast(UI_TEXT.account.settingsSaved);
  });

  logoutBtn.addEventListener("click", () => {
    clearStoredAccount();
    clearProfileSessionState();
    showToast(UI_TEXT.account.loggedOut);
    void promptAccountSetup();
  });

  [cancelBtn, closeBtn].forEach(btn => btn.addEventListener("click", closeMenu));

  return menu;
}

function ensureSearchModalEl(): HTMLElement {
  let overlay = document.getElementById("itunes-search-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "itunes-search-overlay";
  overlay.className = "itunes-search-overlay";
  overlay.innerHTML = `
    <div class="itunes-search-modal" role="dialog" aria-modal="true" aria-labelledby="itunes-search-title">
      <div class="itunes-search-header">
        <div>
          <div class="itunes-search-kicker">${UI_TEXT.search.kicker}</div>
          <h2 id="itunes-search-title">${UI_TEXT.search.title}</h2>
        </div>
        <button id="itunes-search-close" class="itunes-search-close" type="button" aria-label="${UI_TEXT.common.close}">${closeIcon(16)}</button>
      </div>

      <p class="itunes-search-copy">${UI_TEXT.search.copy}</p>

      <label class="itunes-search-label" for="itunes-search-input">${UI_TEXT.search.termLabel}</label>
      <input id="itunes-search-input" class="itunes-search-input" type="text" placeholder="${UI_TEXT.search.placeholder}" autocomplete="off" />

      <div class="itunes-search-error" aria-live="polite"></div>

      <div class="itunes-search-actions">
        <button id="itunes-search-cancel" class="itunes-search-secondary" type="button">${UI_TEXT.common.close}</button>
        <button id="itunes-search-submit" class="itunes-search-primary" type="button">${UI_TEXT.search.kicker}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#itunes-search-input") as HTMLInputElement;
  const submitBtn = overlay.querySelector("#itunes-search-submit") as HTMLButtonElement;
  const cancelBtn = overlay.querySelector("#itunes-search-cancel") as HTMLButtonElement;
  const closeBtn = overlay.querySelector("#itunes-search-close") as HTMLButtonElement;

  const closeSearch = () => closeItunesSearchModal();

  const runSearch = async () => {
    const query = input.value.trim();
    const error = overlay!.querySelector<HTMLElement>(".itunes-search-error");
    if (!query) {
      if (error) error.textContent = UI_TEXT.search.emptyQuery;
      input.focus();
      return;
    }

    if (error) error.textContent = "";
    closeSearch();

    try {
      await importItunesPlaylistFromQuery(query);
      homeSearchQuery = query;
      viewMode = "home";
      renderAll();
    } catch (_err) {
      showToast(UI_TEXT.search.requestError, "error");
    }
  };

  submitBtn.addEventListener("click", () => { void runSearch(); });
  cancelBtn.addEventListener("click", closeSearch);
  closeBtn.addEventListener("click", closeSearch);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  });

  return overlay;
}

function openItunesSearchModal(): void {
  const overlay = ensureSearchModalEl();
  const input = overlay.querySelector("#itunes-search-input") as HTMLInputElement;
  const error = overlay.querySelector<HTMLElement>(".itunes-search-error");

  input.value = homeSearchQuery.trim();
  if (error) error.textContent = "";

  overlay.classList.add("open");
  input.focus();
  input.select();

  if (!searchMenuOutsideHandler) {
    searchMenuOutsideHandler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const menu = document.getElementById("itunes-search-overlay");
      const dialog = document.querySelector(".itunes-search-modal");
      if (!target || !menu || !dialog) return;
      if (dialog.contains(target)) return;
      closeItunesSearchModal();
    };
  }

  if (!searchMenuKeyHandler) {
    searchMenuKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeItunesSearchModal();
      }
    };
  }

  document.addEventListener("mousedown", searchMenuOutsideHandler);
  document.addEventListener("keydown", searchMenuKeyHandler);
}

function closeItunesSearchModal(): void {
  const overlay = document.getElementById("itunes-search-overlay");
  overlay?.classList.remove("open");

  if (searchMenuOutsideHandler) {
    document.removeEventListener("mousedown", searchMenuOutsideHandler);
  }

  if (searchMenuKeyHandler) {
    document.removeEventListener("keydown", searchMenuKeyHandler);
  }
}

function syncAccountMenu(): void {
  if (!currentAccount) return;

  const menu = ensureAccountMenuEl();
  const nameInput = menu.querySelector("#account-menu-name") as HTMLInputElement;
  const error = menu.querySelector<HTMLElement>(".account-menu-error");
  const themePicker = menu.querySelector("#account-menu-theme-picker") as HTMLDivElement;

  nameInput.value = currentAccount.name;
  if (error) error.textContent = "";

  themePicker.querySelectorAll<HTMLButtonElement>(".account-theme-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === currentAccount!.theme);
  });
}

function openAccountMenu(): void {
  if (!currentAccount) {
    void promptAccountSetup();
    return;
  }

  const menu = ensureAccountMenuEl();
  syncAccountMenu();
  menu.classList.add("open");

  const chip = ensureAccountChipEl();
  chip.setAttribute("aria-expanded", "true");

  if (!accountMenuOutsideHandler) {
    accountMenuOutsideHandler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const chipEl = document.getElementById("account-chip");
      const menuEl = document.getElementById("account-menu");

      if (!target || !chipEl || !menuEl) return;
      if (chipEl.contains(target) || menuEl.contains(target)) return;
      closeAccountMenu();
    };
  }

  if (!accountMenuKeyHandler) {
    accountMenuKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAccountMenu();
      }
    };
  }

  document.addEventListener("mousedown", accountMenuOutsideHandler);
  document.addEventListener("keydown", accountMenuKeyHandler);

  const nameInput = menu.querySelector("#account-menu-name") as HTMLInputElement;
  nameInput.focus();
  nameInput.select();
}

function closeAccountMenu(): void {
  const menu = document.getElementById("account-menu");
  if (menu) {
    menu.classList.remove("open");
  }

  const chip = document.getElementById("account-chip");
  chip?.setAttribute("aria-expanded", "false");

  if (accountMenuOutsideHandler) {
    document.removeEventListener("mousedown", accountMenuOutsideHandler);
  }

  if (accountMenuKeyHandler) {
    document.removeEventListener("keydown", accountMenuKeyHandler);
  }
}

function toggleAccountMenu(): void {
  const menu = document.getElementById("account-menu");
  if (menu?.classList.contains("open")) {
    closeAccountMenu();
  } else {
    openAccountMenu();
  }
}

function ensureAccountSetupModal(): HTMLElement {
  let overlay = document.getElementById("account-setup-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "account-setup-overlay";
  overlay.className = "account-setup-overlay";
  overlay.innerHTML = `
    <div class="account-setup-modal" role="dialog" aria-modal="true" aria-labelledby="account-setup-title">
      <h2 id="account-setup-title">${UI_TEXT.account.setupTitle}</h2>
      <p>${UI_TEXT.account.setupCopy}</p>
      <label class="account-label" for="account-name-input">${UI_TEXT.account.nameLabel}</label>
      <input id="account-name-input" class="account-input" type="text" maxlength="28" placeholder="${UI_TEXT.account.yourName}" autocomplete="off" />

      <label class="account-label" for="account-theme-select">${UI_TEXT.account.themeLabel}</label>
      <div class="account-theme-picker" id="account-theme-picker">
        <button type="button" class="account-theme-option active" data-theme="dark">${UI_TEXT.account.darkTheme}</button>
        <button type="button" class="account-theme-option" data-theme="light">${UI_TEXT.account.lightTheme}</button>
      </div>

      <div id="account-setup-error" class="account-error"></div>
      <button id="account-save-btn" class="account-save-btn">${UI_TEXT.account.enter}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

async function promptAccountSetup(): Promise<void> {
  const overlay = ensureAccountSetupModal();
  const nameInput = document.getElementById("account-name-input") as HTMLInputElement;
  const themePicker = document.getElementById("account-theme-picker") as HTMLDivElement;
  const saveBtn = document.getElementById("account-save-btn") as HTMLButtonElement;
  const errorEl = document.getElementById("account-setup-error") as HTMLDivElement;

  nameInput.value = "";
  errorEl.textContent = "";
  overlay.classList.add("open");

  await new Promise<void>(resolve => {
    const getSelectedTheme = (): AccountTheme => {
      const active = themePicker.querySelector<HTMLButtonElement>(".account-theme-option.active");
      return active?.dataset.theme === "light" ? "light" : "dark";
    };

    const setThemeSelection = (theme: AccountTheme) => {
      themePicker.querySelectorAll<HTMLButtonElement>(".account-theme-option").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.theme === theme);
      });
    };

    themePicker.querySelectorAll<HTMLButtonElement>(".account-theme-option").forEach(btn => {
      btn.addEventListener("click", () => {
        setThemeSelection((btn.dataset.theme === "light" ? "light" : "dark") as AccountTheme);
      });
    });

    setThemeSelection("dark");

    const submit = () => {
      const name = nameInput.value.trim();
      const theme = getSelectedTheme();

      if (!name) {
        errorEl.textContent = UI_TEXT.account.nameRequired;
        nameInput.focus();
        return;
      }

      currentAccount = { name, theme };
      applyAccountTheme(theme);
      saveCurrentAccount();
      loadFavoriteKeysForCurrentAccount();
      syncFavoritesPlaylistFromCache();
      renderAccountChip();
      overlay.classList.remove("open");
      saveBtn.removeEventListener("click", submit);
      nameInput.removeEventListener("keydown", onKeyDown);
      resolve();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };

    saveBtn.addEventListener("click", submit);
    nameInput.addEventListener("keydown", onKeyDown);
    nameInput.focus();
  });
}

// ── SIDEBAR ───────────────────────────────────────────────
function renderSidebar(): void {
  sidebarPlaylistsEl.innerHTML = "";

  homeNavEl?.classList.toggle("active", viewMode === "home");

  player.playlists.forEach(pl => {
    const isActive = viewMode === "playlist" && pl === player.currentPlaylist;
    const canDelete = pl.name !== FAVORITES_PLAYLIST_NAME;
    const li = document.createElement("li");
    li.className = "sidebar-pl-item" + (isActive ? " active" : "");

    li.innerHTML = `
      <div class="sidebar-pl-cover">
        ${pl.cover
          ? `<img src="${pl.cover}" alt="${escHtml(pl.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ""}
        <div class="sidebar-pl-cover-fallback" style="${pl.cover ? "display:none" : ""}; background:${pl.color}">
          ${musicNoteIcon(20)}
        </div>
      </div>
      <div class="sidebar-pl-info">
        <span class="sidebar-pl-name">${escHtml(pl.name)}</span>
        <span class="sidebar-pl-meta">Playlist · ${pl.size} canciones</span>
      </div>
      ${canDelete
        ? `<button class="sidebar-pl-delete" data-name="${escHtml(pl.name)}" title="${UI_TEXT.common.delete}">${closeIcon(14)}</button>`
        : ""}
    `;

    li.addEventListener("click", e => {
      if ((e.target as HTMLElement).closest(".sidebar-pl-delete")) return;
      player.switchPlaylist(pl.name);
      viewMode = "playlist";
      isQueuePanelOpen = false;
      stopProgress();
      audioPlayer.currentTime = 0;
      currentProgress = 0;
      renderAll();
    });

    li.querySelector(".sidebar-pl-delete")?.addEventListener("click", e => {
      e.stopPropagation();
      handleDeletePlaylist(pl.name);
    });

    sidebarPlaylistsEl.appendChild(li);
  });
}

// ── MAIN ──────────────────────────────────────────────────
function renderMain(): void {
  if (viewMode === "home") {
    renderHome();
    return;
  }

  const pl = player.currentPlaylist;

  if (!pl) {
    renderHome();
    return;
  }

  const tracks = pl.getTracks();
  const hasPrevInQueue = !!pl.current?.prev;
  const hasNextInQueue = !!pl.current?.next;
  const nowPlayingTrack = pl.current?.track ?? null;
  const coverStyle = pl.cover
    ? `background-image: url('${pl.cover}'); background-size: cover; background-position: center;`
    : `background: ${pl.color};`;

  mainEl.innerHTML = `
    <div class="playlist-layout${isQueuePanelOpen ? " queue-open" : ""}">
      <section class="playlist-content">
        <!-- HEADER con degradado del color de la playlist -->
        <div class="main-header" style="--pl-color: ${pl.color}">
          <div class="main-header-cover" style="${coverStyle}">
            ${!pl.cover ? musicNoteIcon(56) : ""}
          </div>
          <div class="main-header-info">
            <span class="main-header-type">${UI_TEXT.playlist.label}</span>
            <h1 class="main-header-title">${escHtml(pl.name)}</h1>
            <p class="main-header-meta">${pl.size} ${UI_TEXT.common.songsWord} &nbsp;·&nbsp; ${pl.formattedTotalDuration()}</p>
            <div class="main-header-actions">
              <button class="btn-play-big" id="btn-play-big">
                ${player.isPlaying && player.currentPlaylist === pl ? pauseIcon(28) : playIcon(28)}
              </button>
              <button class="btn-add-track" id="btn-view-queue">
                ${listIcon(16)} ${isQueuePanelOpen ? UI_TEXT.playlist.hideQueue : UI_TEXT.playlist.showQueue}
              </button>
              <button class="btn-add-track" id="btn-add-track">
                ${plusIcon(16)} ${UI_TEXT.playlist.addSong}
              </button>
            </div>
          </div>
        </div>

        <!-- COLUMNAS -->
        <div class="tracks-table">
          <div class="tracks-thead">
            <span class="col-num">#</span>
            <span class="col-info">${UI_TEXT.playlist.titleColumn}</span>
            <span class="col-dur">${clockIcon(14)}</span>
          </div>
          <ul class="tracks-tbody" id="tracks-tbody">
            ${tracks.length === 0
              ? `<li class="tracks-empty">
                   ${musicNoteIcon(40)}
                    <p>${UI_TEXT.playlist.emptyTitle}</p>
                    <span>${UI_TEXT.playlist.emptyCopy}</span>
                 </li>`
              : tracks.map((t, i) => renderTrackRow(t, i, pl)).join("")
            }
          </ul>
        </div>
      </section>

      ${isQueuePanelOpen ? `
      <aside class="queue-sidebar">
        <div class="queue-sidebar-head">
          <h3>${UI_TEXT.playlist.queueTitle}</h3>
        </div>

        <div class="queue-block">
          <h4>${UI_TEXT.playlist.nowPlayingTitle}</h4>
          ${nowPlayingTrack
            ? `<div class="queue-now-item">
                <div class="queue-now-cover">${musicNoteIcon(18)}</div>
                <div class="queue-now-copy">
                  <strong>${escHtml(nowPlayingTrack.title)}</strong>
                  <span>${escHtml(nowPlayingTrack.artist)}</span>
                </div>
              </div>`
            : `<div class="queue-empty">${UI_TEXT.playlist.noSongSelected}</div>`}
        </div>

        <div class="queue-controls">
          <button class="queue-ctrl${hasPrevInQueue ? "" : " disabled"}" id="queue-prev">${skipPrevIcon()} ${UI_TEXT.playlist.previous}</button>
          <button class="queue-ctrl${hasNextInQueue ? "" : " disabled"}" id="queue-next">${UI_TEXT.playlist.next} ${skipNextIcon()}</button>
        </div>

        <div class="queue-block">
          <h4>${UI_TEXT.playlist.nextFromPrefix} ${escHtml(pl.name)}</h4>
          <ul class="queue-list">
            ${renderQueueUpcomingNodes(pl)}
          </ul>
        </div>
      </aside>
      ` : ""}
    </div>
  `;

  // Eventos del header
  document.getElementById("btn-play-big")?.addEventListener("click", () => {
    if (!pl.current) return;
    const playing = player.togglePlay();
    playing ? startProgress() : stopProgress();
    renderAll();
  });

  document.getElementById("btn-add-track")?.addEventListener("click", () => openModal());

  document.getElementById("btn-view-queue")?.addEventListener("click", () => {
    isQueuePanelOpen = !isQueuePanelOpen;
    renderAll();
  });

  document.getElementById("queue-prev")?.addEventListener("click", async () => {
    if (!pl.current?.prev) return;
    const track = player.previous();
    if (!track) return;
    currentProgress = 0;
    currentTrackDuration = track.duration;
    if (player.isPlaying) {
      await preparePreviewPlayback(track, true);
      startProgress();
    }
    renderAll();
  });

  document.getElementById("queue-next")?.addEventListener("click", async () => {
    if (!pl.current?.next) return;
    const track = player.next();
    if (!track) return;
    currentProgress = 0;
    currentTrackDuration = track.duration;
    if (player.isPlaying) {
      await preparePreviewPlayback(track, true);
      startProgress();
    }
    renderAll();
  });

  // Eventos de filas
  document.querySelectorAll<HTMLLIElement>(".track-row").forEach(row => {
    row.addEventListener("click", e => {
      if ((e.target as HTMLElement).closest(".track-delete-btn") || (e.target as HTMLElement).closest(".track-favorite-btn")) return;
      const title = row.dataset.title!;
      pl.selectTrack(title);
      const selectedTrack = pl.current?.track ?? null;
      if (!selectedTrack) return;
      viewMode = "playlist";
      void preparePreviewPlayback(selectedTrack, true);
      renderAll();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".track-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      handleDeleteTrack(btn.dataset.title!);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".track-favorite-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const title = btn.dataset.favoriteTitle;
      if (!title) return;
      const selected = player.playlists
        .flatMap(playlist => playlist.getTracks())
        .find(track => track.title === title);
      if (selected) toggleTrackFavorite(selected);
    });
  });
}

function renderHome(): void {
  const playlists = player.playlists;

  mainEl.innerHTML = `
    <section class="home-view">
      <div class="home-toolbar">
        <div class="home-search-shell">
          ${searchIcon(18)}
          <input type="text" id="home-search-input" class="home-search-input" placeholder="${UI_TEXT.search.homePlaceholder}" value="${escHtml(homeSearchQuery)}" autocomplete="off" />
        </div>
      </div>

      <div id="home-content"></div>
    </section>
  `;

  renderHomeContent();

  const searchInput = document.getElementById("home-search-input") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      homeSearchQuery = searchInput.value;
      viewMode = "home";
      scheduleLiveItunesSearch(homeSearchQuery);
      renderHomeContent();
    });
    searchInput.addEventListener("keydown", async e => {
      if (e.key === "Enter") {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;
        await importItunesPlaylistFromQuery(query);
        homeSearchQuery = query;
        viewMode = "home";
        renderAll();
      }
    });
  }

  document.getElementById("home-open-search")?.addEventListener("click", () => {
    focusInlineHomeSearch(true);
  });

  document.querySelectorAll<HTMLElement>("[data-playlist-name]").forEach(card => {
    card.addEventListener("click", () => {
      const playlist = player.playlists.find(pl => pl.name === card.dataset.playlistName);
      if (!playlist) return;
      player.switchPlaylist(playlist.name);
      viewMode = "playlist";
      renderAll();
    });
  });

  document.querySelectorAll<HTMLElement>("[data-track-title]").forEach(row => {
    row.addEventListener("click", () => {
      const playlist = player.playlists.find(pl => pl.name === row.dataset.playlistName);
      if (!playlist) return;
      const trackTitle = row.dataset.trackTitle ?? "";
      if (!playlist.selectTrack(trackTitle)) return;
      player.switchPlaylist(playlist.name);
      viewMode = "playlist";
      const selectedTrack = playlist.current?.track ?? null;
      if (!selectedTrack) return;
      void preparePreviewPlayback(selectedTrack, true);
      renderAll();
    });
  });

}

function focusInlineHomeSearch(selectText = false): void {
  const input = document.getElementById("home-search-input") as HTMLInputElement | null;
  if (!input) return;
  input.focus();
  if (selectText) {
    input.select();
  }
}

function renderHomeContent(): void {
  const contentEl = document.getElementById("home-content");
  if (!contentEl) return;

  const playlists = player.playlists;
  const searchResults = getHomeSearchResults(homeSearchQuery);
  const searchQuery = homeSearchQuery.trim();
  const hasLiveResults = normalizeSearchText(liveItunesQuery) === normalizeSearchText(searchQuery)
    && liveItunesTracks.length > 0;
  const filteredPlaylists = homeSearchQuery.trim()
    ? playlists.filter(pl => matchesHomeSearch(pl.name, pl.getTracks(), homeSearchQuery))
    : playlists;
  const featured = filteredPlaylists.slice(0, 4);
  const recent = filteredPlaylists.slice(0, 6);

  contentEl.innerHTML = `
    <section class="home-section">
      <div class="home-section-head">
        <h2>${homeSearchQuery.trim() ? UI_TEXT.playlist.searchResultsTitle : UI_TEXT.playlist.featuredTitle}</h2>
        <button class="home-link" id="home-open-search">${UI_TEXT.search.showAll}</button>
      </div>
      <div class="home-card-row">
        ${homeSearchQuery.trim()
          ? searchResults.length > 0
            ? searchResults.slice(0, 4).map(result => renderHomeTrackCard(result)).join("")
            : `<div class="home-empty-card">No hay coincidencias para "${escHtml(homeSearchQuery)}". Mostrando canciones disponibles.</div>`
          : featured.length > 0
          ? featured.map(pl => renderHomePlaylistCard(pl)).join("")
          : `<div class="home-empty-card">Usa Buscar para cargar playlists en Melodify.</div>`}
      </div>
    </section>

    ${searchQuery ? `
    <section class="home-section">
      <div class="home-section-head">
        <h2>${UI_TEXT.search.songsSection}</h2>
      </div>
      <div class="home-track-results">
        ${searchResults.length > 0
          ? searchResults.map(result => renderHomeSearchResult(result)).join("")
          : hasLiveResults
          ? liveItunesTracks.map(track => renderLiveItunesResult(track, liveItunesCover)).join("")
          : liveItunesLoading
          ? `<div class="home-empty-card">Buscando en Melodify...</div>`
          : `<div class="home-empty-card">No se encontraron canciones.</div>`}
      </div>
    </section>
    ` : `
    <section class="home-section">
      <div class="home-section-head">
        <h2>${UI_TEXT.search.recentSection}</h2>
      </div>
      <div class="home-card-grid">
        ${recent.length > 0
          ? recent.map(pl => renderHomeRecentCard(pl)).join("")
          : `<div class="home-empty-card">Todavía no hay contenido reciente.</div>`}
      </div>
    </section>
    `}
  `;

  document.getElementById("home-open-search")?.addEventListener("click", () => {
    focusInlineHomeSearch(true);
  });

  document.querySelectorAll<HTMLElement>("[data-playlist-name]").forEach(card => {
    card.addEventListener("click", () => {
      const playlist = player.playlists.find(pl => pl.name === card.dataset.playlistName);
      if (!playlist) return;
      player.switchPlaylist(playlist.name);
      viewMode = "playlist";
      renderAll();
    });
  });

  document.querySelectorAll<HTMLElement>("[data-track-title]").forEach(row => {
    row.addEventListener("click", () => {
      const playlist = player.playlists.find(pl => pl.name === row.dataset.playlistName);
      if (!playlist) return;
      const trackTitle = row.dataset.trackTitle ?? "";
      if (!playlist.selectTrack(trackTitle)) return;
      player.switchPlaylist(playlist.name);
      viewMode = "playlist";
      currentProgress = 0;
      currentTrackDuration = playlist.current?.track.duration ?? 0;
      player.isPlaying = true;
      startProgress();
      renderAll();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-favorite-track]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const playlistName = btn.closest<HTMLElement>("[data-playlist-name]")?.dataset.playlistName;
      const trackTitle = btn.dataset.favoriteTrack ?? "";

      if (playlistName) {
        const playlist = player.playlists.find(pl => pl.name === playlistName);
        const track = playlist?.getTracks().find(t => t.title === trackTitle) ?? null;
        if (track) {
          toggleTrackFavorite(track);
        }
        return;
      }

      const liveTrack = liveItunesTracks.find(track => track.title === trackTitle);
      if (liveTrack) {
        toggleTrackFavorite(liveTrack);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".home-live-row .home-result-play").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      if (!liveItunesQuery) return;
      await importItunesPlaylistFromQuery(liveItunesQuery);
    });
  });
}

function renderHomePlaylistCard(pl: Playlist): string {
  return `
    <article class="home-playlist-card" data-playlist-name="${escHtml(pl.name)}">
      <div class="home-playlist-cover" style="${pl.cover ? `background-image:url('${pl.cover}'); background-size:cover; background-position:center;` : `background:${pl.color};`}">
        ${!pl.cover ? musicNoteIcon(34) : ""}
      </div>
      <div class="home-playlist-meta">
        <span class="home-card-title">${escHtml(pl.name)}</span>
        <span class="home-card-subtitle">${uiFormat.playlistMeta(pl.size)}</span>
      </div>
    </article>
  `;
}

function renderHomeTrackCard(result: HomeSearchResult): string {
  return `
    <article class="home-playlist-card home-track-card" data-playlist-name="${escHtml(result.playlist.name)}">
      <div class="home-playlist-cover" style="${result.playlist.cover ? `background-image:url('${result.playlist.cover}'); background-size:cover; background-position:center;` : `background:${result.playlist.color};`}">
        ${!result.playlist.cover ? musicNoteIcon(34) : ""}
      </div>
      <div class="home-playlist-meta">
        <span class="home-card-title">${escHtml(result.track.title)}</span>
        <span class="home-card-subtitle">${escHtml(result.track.artist)} · ${escHtml(result.playlist.name)}</span>
      </div>
    </article>
  `;
}

function renderHomeSearchResult(result: HomeSearchResult): string {
  const favorite = isTrackFavorite(result.track);
  return `
    <article class="home-result-row" data-playlist-name="${escHtml(result.playlist.name)}" data-track-title="${escHtml(result.track.title)}">
      <div class="home-result-cover" style="${result.playlist.cover ? `background-image:url('${result.playlist.cover}'); background-size:cover; background-position:center;` : `background:${result.playlist.color};`}">
        ${!result.playlist.cover ? musicNoteIcon(24) : ""}
      </div>
      <div class="home-result-copy">
        <strong>${escHtml(result.track.title)}</strong>
        <span>${escHtml(result.track.artist)} · ${escHtml(result.playlist.name)}</span>
      </div>
      <button class="home-result-heart${favorite ? " active" : ""}" data-favorite-track="${escHtml(result.track.title)}" title="${favorite ? UI_TEXT.common.removeFromFavorites : UI_TEXT.common.addToFavorites}">${favoriteIcon(favorite)}</button>
      <button class="home-result-play" title="${UI_TEXT.common.play}">${playIcon(18)}</button>
    </article>
  `;
}

function renderLiveItunesResult(track: Track, cover: string): string {
  return `
    <article class="home-result-row home-live-row">
      <div class="home-result-cover" style="${cover ? `background-image:url('${cover}'); background-size:cover; background-position:center;` : `background:var(--bg-hover);`}">
        ${!cover ? musicNoteIcon(24) : ""}
      </div>
      <div class="home-result-copy">
        <strong>${escHtml(track.title)}</strong>
        <span>${escHtml(uiFormat.searchSource(track.artist))}</span>
      </div>
      <button class="home-result-heart${isTrackFavorite(track) ? " active" : ""}" data-favorite-track="${escHtml(track.title)}" title="${isTrackFavorite(track) ? UI_TEXT.common.removeFromFavorites : UI_TEXT.common.addToFavorites}">${favoriteIcon(isTrackFavorite(track))}</button>
      <button class="home-result-play" title="${UI_TEXT.common.playPreview}">${playIcon(18)}</button>
    </article>
  `;
}

function renderHomeRecentCard(pl: Playlist): string {
  const firstTrack = pl.getTracks()[0];
  return `
    <article class="home-recent-card" data-playlist-name="${escHtml(pl.name)}">
      <div class="home-recent-cover" style="${pl.cover ? `background-image:url('${pl.cover}'); background-size:cover; background-position:center;` : `background:${pl.color};`}">
        ${!pl.cover ? musicNoteIcon(24) : ""}
      </div>
      <div class="home-recent-copy">
        <strong>${escHtml(pl.name)}</strong>
        <span>${firstTrack ? escHtml(firstTrack.artist) : uiFormat.playlistMeta(pl.size)}</span>
      </div>
    </article>
  `;
}

type HomeSearchResult = { playlist: Playlist; track: Track };

function matchesHomeSearch(name: string, tracks: Track[], query: string): boolean {
  const q = normalizeSearchText(query.trim());
  if (!q) return true;
  return normalizeSearchText(name).includes(q)
    || tracks.some(track => normalizeSearchText(`${track.title} ${track.artist}`).includes(q));
}

function getHomeSearchResults(query: string): HomeSearchResult[] {
  const q = normalizeSearchText(query.trim());
  if (!q) return [];

  const results: HomeSearchResult[] = [];
  player.playlists.forEach(playlist => {
    playlist.getTracks().forEach(track => {
      const haystack = normalizeSearchText(`${track.title} ${track.artist} ${playlist.name}`);
      if (haystack.includes(q)) {
        results.push({ playlist, track });
      }
    });
  });

  return results;
}

function renderTrackRow(track: Track, index: number, pl: Playlist): string {
  const isCurrent = pl.current?.track === track;
  const isPlayingThis = isCurrent && player.isPlaying;
  const favorite = isTrackFavorite(track);

  return `
    <li class="track-row${isCurrent ? " track-current" : ""}" data-title="${escHtml(track.title)}">
      <span class="col-num">
        ${isPlayingThis
          ? `<div class="eq"><span></span><span></span><span></span></div>`
          : `<span class="track-index">${index + 1}</span>
             <button class="track-row-play">${playIcon(16)}</button>`
        }
      </span>
      <span class="col-info">
        <span class="track-cover-mini" style="background:${pl.color}">
          ${pl.cover ? `<img src="${pl.cover}" alt="">` : musicNoteIcon(14)}
        </span>
        <span class="track-text">
          <span class="track-title${isCurrent ? " active-title" : ""}">${escHtml(track.title)}</span>
          <span class="track-artist">${escHtml(track.artist)}</span>
        </span>
      </span>
      <span class="col-dur">
        <span class="track-dur-val">${track.formattedDuration()}</span>
        <button class="track-favorite-btn${favorite ? " active" : ""}" data-favorite-title="${escHtml(track.title)}" title="${favorite ? UI_TEXT.common.removeFromFavorites : UI_TEXT.common.addToFavorites}">${favoriteIcon(favorite)}</button>
        <button class="track-delete-btn" data-title="${escHtml(track.title)}" title="${UI_TEXT.common.delete}">
          ${trashIcon(15)}
        </button>
      </span>
    </li>
  `;
}

function renderQueueNodes(pl: Playlist): string {
  if (!pl.head) {
    return `<li class="queue-empty">${UI_TEXT.playlist.queueEmptyWithHint}</li>`;
  }

  const rows: string[] = [];
  let node: PlaylistNode | null = pl.head;
  let index = 1;

  while (node) {
    const isCurrent = pl.current === node;
    rows.push(`
      <li class="queue-node${isCurrent ? " current" : ""}">
        <span class="queue-pos">${index}</span>
        <span class="queue-copy">
          <strong>${escHtml(node.track.title)}</strong>
          <small>${escHtml(node.track.artist)}</small>
        </span>
        <span class="queue-links">${node.prev ? "◀" : "·"} ${isCurrent ? "ACTUAL" : ""} ${node.next ? "▶" : "·"}</span>
      </li>
    `);
    node = node.next;
    index++;
  }

  return rows.join("");
}

function renderQueueUpcomingNodes(pl: Playlist): string {
  if (!pl.head) {
    return `<li class="queue-empty">${UI_TEXT.playlist.queueEmpty}</li>`;
  }

  const rows: string[] = [];
  let node: PlaylistNode | null = pl.current?.next ?? pl.head;

  while (node) {
    rows.push(`
      <li class="queue-node">
        <div class="queue-now-cover mini">${musicNoteIcon(14)}</div>
        <span class="queue-copy">
          <strong>${escHtml(node.track.title)}</strong>
          <small>${escHtml(node.track.artist)}</small>
        </span>
        <span class="queue-links">${node.prev ? "◀" : "·"} ${node.next ? "▶" : "·"}</span>
      </li>
    `);
    node = node.next;
  }

  if (rows.length === 0) {
    return `<li class="queue-empty">${UI_TEXT.playlist.queueNoUpcoming}</li>`;
  }

  return rows.join("");
}

// ── FOOTER ────────────────────────────────────────────────
function renderFooter(): void {
  const pl = player.currentPlaylist;
  const track = pl?.current?.track ?? null;
  const pct = currentTrackDuration > 0 ? (currentProgress / currentTrackDuration) * 100 : 0;
  const hasNext = !!pl?.current?.next;
  const hasPrev = !!pl?.current?.prev;
  const volumePct = Math.round(desiredVolume * 100);

  footerEl.innerHTML = `
    <!-- NOW PLAYING -->
    <div class="footer-left">
      <div class="footer-cover">
        ${pl?.cover
          ? `<img src="${pl.cover}" alt="" onerror="this.style.display='none'">`
          : `<div class="footer-cover-fallback">${musicNoteIcon(22)}</div>`}
      </div>
      <div class="footer-track-info">
        <span class="footer-track-title">${track ? escHtml(track.title) : "Sin reproduccion"}</span>
        <span class="footer-track-artist">${track ? escHtml(track.artist) : "—"}</span>
      </div>
      ${track ? `<button class="footer-heart${isTrackFavorite(track) ? " active" : ""}" id="footer-heart" title="${isTrackFavorite(track) ? UI_TEXT.common.removeFromFavorites : UI_TEXT.common.addToFavorites}">${favoriteIcon(isTrackFavorite(track))}</button>` : ""}
    </div>

    <!-- CONTROLS -->
    <div class="footer-center">
      <div class="footer-btns">
        <button class="footer-ctrl${hasPrev ? "" : " disabled"}" id="fc-prev" title="${UI_TEXT.playlist.previous}">${skipPrevIcon()}</button>
        <button class="footer-ctrl footer-play" id="fc-play">
          ${player.isPlaying ? pauseIcon(26) : playIcon(26)}
        </button>
        <button class="footer-ctrl${hasNext ? "" : " disabled"}" id="fc-next" title="${UI_TEXT.playlist.next}">${skipNextIcon()}</button>
        <button class="footer-ctrl footer-dj${djModeEnabled ? " active" : ""}" id="fc-dj" title="${UI_TEXT.player.djModeTitle}">DJ</button>
      </div>
      <div class="footer-progress">
        <span class="footer-time">${formatTime(currentProgress)}</span>
        <div class="footer-bar" id="footer-bar">
          <div class="footer-bar-fill" style="width:${pct}%">
            <div class="footer-bar-thumb"></div>
          </div>
        </div>
        <span class="footer-time">${formatTrackDuration(track)}</span>
      </div>
    </div>

    <!-- VOLUME -->
    <div class="footer-right">
      <span class="footer-vol-icon">${volIcon()}</span>
      <div class="footer-vol-bar">
        <div class="footer-vol-fill" style="width:${volumePct}%"></div>
        <input type="range" class="footer-vol-input" id="vol-input" min="0" max="100" value="${volumePct}" />
      </div>
    </div>
  `;

  // Eventos footer
  document.getElementById("fc-prev")?.addEventListener("click", () => {
    const t = player.previous();
    if (t) { currentProgress = 0; currentTrackDuration = t.duration; if (player.isPlaying) startProgress(); }
    renderAll();
  });

  document.getElementById("fc-next")?.addEventListener("click", () => {
    if (djModeEnabled) {
      void handleDjSkipAdvance();
      return;
    }
    const t = player.next();
    if (t) { currentProgress = 0; currentTrackDuration = t.duration; if (player.isPlaying) startProgress(); }
    renderAll();
  });

  document.getElementById("fc-dj")?.addEventListener("click", () => {
    djModeEnabled = !djModeEnabled;
    showToast(djModeEnabled ? UI_TEXT.player.djEnabled : UI_TEXT.player.djDisabled);
    renderFooter();
  });

  document.getElementById("fc-play")?.addEventListener("click", () => {
    if (!pl?.current) return;
    const selectedTrack = pl.current.track;
    if (!selectedTrack.previewUrl) {
      showToast(UI_TEXT.player.previewMissing, "error");
      return;
    }
    const playing = player.togglePlay();
    if (playing) {
      void preparePreviewPlayback(selectedTrack, false);
      startProgress();
    } else {
      stopProgress();
    }
    renderAll();
  });

  document.getElementById("footer-heart")?.addEventListener("click", () => {
    if (track) toggleTrackFavorite(track);
  });

  document.getElementById("footer-bar")?.addEventListener("click", e => {
    if (!track) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (isAudioPreviewTrack(track) && Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0) {
      audioPlayer.currentTime = pct * audioPlayer.duration;
      currentProgress = Math.floor(audioPlayer.currentTime);
      currentTrackDuration = Math.floor(audioPlayer.duration);
    } else {
      currentProgress = Math.floor(pct * currentTrackDuration);
    }
    renderFooter();
  });

  const volInput = document.getElementById("vol-input") as HTMLInputElement;
  volInput?.addEventListener("input", () => {
    const fill = volInput.closest(".footer-right")?.querySelector(".footer-vol-fill") as HTMLElement;
    if (fill) fill.style.width = volInput.value + "%";
    desiredVolume = Math.max(0, Math.min(1, Number(volInput.value) / 100));
    audioPlayer.volume = desiredVolume;
  });
}

// ═══════════════════════════════════════════════════════════
// MODAL — Agregar canción
// ═══════════════════════════════════════════════════════════
function openModal(): void {
  if (!player.currentPlaylist) {
    showToast(UI_TEXT.addSong.selectPlaylistFirst, "error");
    return;
  }

  addSongSearchQuery = "";
  addSongSearchLoading = false;
  addSongSearchResults = [];
  addSongSearchCover = "";
  addSongRecommendationGroups = [];

  if (addSongSearchTimer !== null) {
    clearTimeout(addSongSearchTimer);
    addSongSearchTimer = null;
  }

  modalEl.classList.add("open");
  modalOverlayEl.classList.add("open");
  renderAddSongModal();
  void loadAddSongRecommendations().then(() => {
    if (modalEl.classList.contains("open")) {
      renderAddSongModal();
    }
  });

  window.setTimeout(() => {
    const searchInput = document.getElementById("add-song-search-input") as HTMLInputElement | null;
    searchInput?.focus();
  }, 0);
}

function closeModal(): void {
  addSongSearchRequestId++;
  if (addSongSearchTimer !== null) {
    clearTimeout(addSongSearchTimer);
    addSongSearchTimer = null;
  }
  modalEl.classList.remove("open");
  modalOverlayEl.classList.remove("open");
}

modalOverlayEl.addEventListener("click", closeModal);

function setupScrollFallbackHandlers(): void {
  const isTextInputTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  };

  const applyWheelScroll = (container: HTMLElement, event: WheelEvent) => {
    if (isTextInputTarget(event.target)) return;
    if (container.scrollHeight <= container.clientHeight) return;
    event.preventDefault();
    container.scrollTop += event.deltaY;
  };

  mainEl.addEventListener("wheel", e => {
    applyWheelScroll(mainEl, e);
  }, { passive: false });

  sidebarPlaylistsEl.addEventListener("wheel", e => {
    applyWheelScroll(sidebarPlaylistsEl, e);
  }, { passive: false });
}

// ── Crear playlist ────────────────────────────────────────
newPlaylistBtn.addEventListener("click", () => {
  const name = newPlaylistInput.value.trim();
  if (!name) { showToast(UI_TEXT.playlist.writeName, "error"); return; }
  try {
    // Color aleatorio entre una paleta curada
    const colors = ["#6B3FA0","#C0392B","#1A6B8A","#2E7D32","#E67E22","#16A085","#8E44AD","#D35400"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    player.createPlaylist(name, "", color);
    newPlaylistInput.value = "";
    showToast(uiFormat.playlistCreated(name));
    renderAll();
  } catch (err: any) {
    showToast(mapDomainErrorToMessage(err), "error");
  }
});

newPlaylistInput.addEventListener("keydown", e => { if (e.key === "Enter") newPlaylistBtn.click(); });
modalCancelBtn2?.addEventListener("click", closeModal);

homeNavEl?.addEventListener("click", e => {
  e.preventDefault();
  viewMode = "home";
  isQueuePanelOpen = false;
  renderAll();
});

itunesSearchLinkEl?.addEventListener("click", e => {
  e.preventDefault();

  const wasHome = viewMode === "home";
  viewMode = "home";
  isQueuePanelOpen = false;

  if (!wasHome) {
    renderAll();
  }

  window.requestAnimationFrame(() => {
    focusInlineHomeSearch(true);
  });
});

// ── Handlers ──────────────────────────────────────────────
function handleDeleteTrack(title: string): void {
  const pl = player.currentPlaylist;
  if (!pl) return;
  const wasCurrent = pl.current?.track.title === title;
  if (pl.removeTrack(title)) {
    if (wasCurrent) {
      player.isPlaying = false;
      stopProgress();
      audioPlayer.removeAttribute("src");
      currentProgress = 0;
    }
    showToast(uiFormat.trackRemoved(title));
    renderAll();
  }
}

function handleDeletePlaylist(name: string): void {
  if (name === FAVORITES_PLAYLIST_NAME) {
    showToast(UI_TEXT.playlist.noDeleteFavorites, "error");
    return;
  }
  if (player.playlists.length <= 1) { showToast(UI_TEXT.playlist.noDeleteOnlyOne, "error"); return; }
  player.removePlaylist(name);
  stopProgress();
  audioPlayer.removeAttribute("src");
  currentProgress = 0;
  player.isPlaying = false;
  if (viewMode === "playlist" && player.currentPlaylist?.name === name) {
    viewMode = "home";
    isQueuePanelOpen = false;
  }
  showToast(uiFormat.playlistRemoved(name));
  renderAll();
}

// ── Progreso ──────────────────────────────────────────────
function startProgress(): void {
  stopProgress();
  if (!player.isPlaying) return;

  const track = getCurrentTrack();
  if (!track) return;

  if (isAudioPreviewTrack(track)) {
    if (audioPlayer.src !== track.previewUrl) {
      audioPlayer.src = track.previewUrl;
      audioPlayer.load();
    }
    if (audioPlayer.paused) {
      audioPlayer.play().catch(() => {
        player.isPlaying = false;
        showToast(UI_TEXT.player.previewError, "error");
        renderAll();
      });
    }
    return;
  }

  if (currentTrackDuration === 0) return;
  progressInterval = window.setInterval(() => {
    currentProgress++;
    if (currentProgress >= currentTrackDuration) {
      if (djModeEnabled) {
        void handleDjTrackEnded();
        return;
      }
      const next = player.next();
      currentProgress = 0;
      if (next) {
        currentTrackDuration = next.duration;
        if (isAudioPreviewTrack(next)) {
          startProgress();
        }
        renderAll();
      }
      else { player.isPlaying = false; stopProgress(); renderAll(); }
      return;
    }
    // Actualizar barra sin re-render completo
    syncFooterProgressUI();
  }, 1000);
}

function stopProgress(): void {
  if (progressInterval !== null) { clearInterval(progressInterval); progressInterval = null; }
  audioPlayer.pause();
}

// ── Helpers ───────────────────────────────────────────────
function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function applyStaticPageTexts(): void {
  const homeNavLabel = homeNavEl?.querySelector("span");
  if (homeNavLabel) homeNavLabel.textContent = UI_TEXT.staticPage.navHome;

  const searchNavLabel = itunesSearchLinkEl?.querySelector("span");
  if (searchNavLabel) searchNavLabel.textContent = UI_TEXT.staticPage.navSearch;

  const libraryTitle = document.querySelector(".sidebar-library-header span");
  if (libraryTitle) libraryTitle.textContent = UI_TEXT.staticPage.libraryTitle;

  if (newPlaylistInput) newPlaylistInput.placeholder = UI_TEXT.staticPage.newPlaylistPlaceholder;
  if (newPlaylistBtn) newPlaylistBtn.setAttribute("title", UI_TEXT.staticPage.newPlaylistTitle);

  const modalTitle = document.querySelector("#modal .modal-header h2");
  if (modalTitle) modalTitle.textContent = UI_TEXT.staticPage.modalTitle;

  const modalLabels = document.querySelectorAll("#modal .modal-field label");
  if (modalLabels[0]) modalLabels[0].innerHTML = `${UI_TEXT.staticPage.modalSongLabel} <span class="req">*</span>`;
  if (modalLabels[1]) modalLabels[1].innerHTML = `${UI_TEXT.staticPage.modalArtistLabel} <span class="req">*</span>`;
  if (modalLabels[2]) modalLabels[2].innerHTML = `${UI_TEXT.staticPage.modalDurationLabel} <small>mm:ss</small>`;
  if (modalLabels[3]) modalLabels[3].innerHTML = `${UI_TEXT.staticPage.modalPositionLabel} <small>${UI_TEXT.staticPage.modalOptional}</small>`;

  modalTitleInput.placeholder = UI_TEXT.staticPage.modalSongPlaceholder;
  modalArtistInput.placeholder = UI_TEXT.staticPage.modalArtistPlaceholder;
  modalDurationInput.placeholder = UI_TEXT.staticPage.modalDurationPlaceholder;
  modalPositionInput.placeholder = UI_TEXT.staticPage.modalPositionPlaceholder;

  if (modalCancelBtn2) modalCancelBtn2.textContent = UI_TEXT.staticPage.modalCancel;
  if (modalSubmitBtn) modalSubmitBtn.textContent = UI_TEXT.staticPage.modalAdd;
}

function mapDomainErrorToMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "playlist_name_required") return UI_TEXT.playlist.writeName;
  if (code === "playlist_name_exists") return UI_TEXT.playlist.nameExists;
  return UI_TEXT.playlist.actionFailed;
}

let toastTimer: number | null = null;
function showToast(msg: string, type: "success"|"error" = "success"): void {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.className = "toast"; }, 3000);
}

function searchIcon(s: number): string {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
}

function favoriteIcon(active: boolean): string {
  return active
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

// ── SVG Icons ─────────────────────────────────────────────
const musicNoteIcon = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v9.28A4.98 4.98 0 0010 12c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5V7h4V3h-7z"/></svg>`;
const playIcon      = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const pauseIcon     = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const plusIcon      = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
const listIcon      = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5h2v-2H4v2zm0 5h2v-2H4v2zM4 5.5h2v-2H4v2zM8 10.5h12v-2H8v2zm0 5h12v-2H8v2zM8 3.5v2h12v-2H8z"/></svg>`;
const closeIcon     = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
const trashIcon     = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const clockIcon     = (s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>`;
const skipPrevIcon  = ()           => `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>`;
const skipNextIcon  = ()           => `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>`;
const heartIcon     = ()           => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const volIcon       = ()           => `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

// ── Arranque ──────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  applyStaticPageTexts();
  setupScrollFallbackHandlers();

  const storedAccount = loadStoredAccount();
  if (storedAccount) {
    currentAccount = storedAccount;
    applyAccountTheme(storedAccount.theme);
  } else {
    await promptAccountSetup();
  }

  await initSampleData();
  loadFavoriteKeysForCurrentAccount();
  syncFavoritesPlaylistFromCache();
  renderAll();
}

bootstrap();
