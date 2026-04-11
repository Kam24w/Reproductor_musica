import { Track, Playlist, PlaylistNode, MusicPlayer } from "./models.js";

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
audioPlayer.volume = 0.75;
let viewMode: "home" | "playlist" = "home";
let homeSearchQuery = "";
const favoriteTrackKeys = new Set<string>();
const FAVORITES_PLAYLIST_NAME = "Mis favoritos";
let liveItunesQuery = "";
let liveItunesTracks: Track[] = [];
let liveItunesCover = "";
let liveItunesLoading = false;
let liveItunesTimer: number | null = null;

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

    showToast("Playlists de iTunes cargadas.");
  } catch (_err) {
    showToast("No se pudieron cargar las playlists iniciales de iTunes.", "error");
  }
}

function buildPlaylistFromItunes(name: string, color: string, data: { tracks: Track[]; cover: string }): void {
  const playlist = player.crearPlaylist(name, data.cover, color);
  data.tracks.forEach(track => playlist.addTrackToEnd(track));
}

async function importItunesPlaylistFromQuery(query: string): Promise<void> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return;

  const playlistName = `iTunes: ${cleanQuery}`;
  const colors = ["#6B3FA0", "#C0392B", "#1A6B8A", "#2E7D32", "#E67E22", "#16A085", "#8E44AD", "#D35400"];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const existing = player.playlists.find(p => p.name === playlistName);
  if (existing) {
    player.eliminarPlaylist(playlistName);
  }

  const data = await fetchItunesSongs(cleanQuery, 12);
  buildPlaylistFromItunes(playlistName, color, data);
  player.cambiarPlaylist(playlistName);
  stopProgress();
  currentProgress = 0;
  renderAll();
  showToast(`Resultados cargados desde iTunes: ${cleanQuery}`);
}

async function fetchItunesSongs(term: string, limit = 8): Promise<{ tracks: Track[]; cover: string }> {
  const url = new URL(ITUNES_API_BASE);
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("country", "MX");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`iTunes respondió con ${response.status}`);
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
    throw new Error("iTunes no devolvió canciones.");
  }

  const cover = normalizeItunesArtwork(results[0]?.artworkUrl100 ?? "");
  return { tracks, cover };
}

function normalizeItunesArtwork(artworkUrl: string): string {
  if (!artworkUrl) return "";
  return artworkUrl.replace(/100x100bb\.jpg$/i, "600x600bb.jpg");
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
  return player.crearPlaylist(FAVORITES_PLAYLIST_NAME, "", "#1DB954");
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
    showToast(`"${track.title}" quitada de favoritos.`);
  } else {
    favoriteTrackKeys.add(key);
    const alreadyInFavorites = favoritesPlaylist.getTracks().some(t => trackKey(t) === key);
    if (!alreadyInFavorites) {
      favoritesPlaylist.addTrackToEnd(new Track(track.title, track.artist, track.duration, track.previewUrl));
    }
    showToast(`"${track.title}" agregada a favoritos.`);
  }
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

async function preparePreviewPlayback(track: Track, restart = false): Promise<boolean> {
  if (!track.previewUrl) {
    showToast("Esta canción no tiene preview disponible en iTunes.", "error");
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
    showToast("No se pudo reproducir el preview de esta canción.", "error");
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
  const next = player.next();
  currentProgress = 0;
  if (next && player.isPlaying) {
    startProgress();
  } else {
    player.isPlaying = false;
    stopProgress();
  }
  renderAll();
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
    chip.textContent = "CU";
    chip.removeAttribute("title");
    return;
  }

  const parts = currentAccount.name.split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : currentAccount.name.slice(0, 2).toUpperCase();

  chip.textContent = initials;
  chip.title = currentAccount.name;
  chip.setAttribute("aria-label", `Perfil de ${currentAccount.name}`);
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
        <div class="account-menu-kicker">Ajustes</div>
        <div class="account-menu-title">Tu perfil</div>
      </div>
      <button id="account-menu-close" class="account-menu-close" type="button" aria-label="Cerrar ajustes">${closeIcon(16)}</button>
    </div>

    <label class="account-label" for="account-menu-name">Nombre</label>
    <input id="account-menu-name" class="account-input" type="text" maxlength="28" autocomplete="off" />

    <label class="account-label">Tema</label>
    <div class="account-theme-picker" id="account-menu-theme-picker">
      <button type="button" class="account-theme-option" data-theme="dark">Oscuro</button>
      <button type="button" class="account-theme-option" data-theme="light">Claro</button>
    </div>

    <div class="account-menu-error" aria-live="polite"></div>

    <div class="account-menu-actions">
      <button id="account-menu-cancel" class="account-menu-secondary" type="button">Cerrar</button>
      <button id="account-menu-save" class="account-menu-primary" type="button">Guardar cambios</button>
    </div>
  `;
  document.body.appendChild(menu);

  const closeMenu = () => closeAccountMenu();
  const saveBtn = menu.querySelector("#account-menu-save") as HTMLButtonElement;
  const cancelBtn = menu.querySelector("#account-menu-cancel") as HTMLButtonElement;
  const closeBtn = menu.querySelector("#account-menu-close") as HTMLButtonElement;
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
    const nameInput = menu!.querySelector("#account-menu-name") as HTMLInputElement;
    const error = menu!.querySelector<HTMLElement>(".account-menu-error");
    const activeTheme = themePicker.querySelector<HTMLButtonElement>(".account-theme-option.active")?.dataset.theme === "light"
      ? "light"
      : "dark";
    const name = nameInput.value.trim();

    if (!name) {
      if (error) error.textContent = "Escribe un nombre para guardar los cambios.";
      nameInput.focus();
      return;
    }

    currentAccount = { name, theme: activeTheme };
    saveCurrentAccount();
    applyAccountTheme(activeTheme);
    renderAccountChip();
    closeMenu();
    showToast("Ajustes guardados.");
  });

  [cancelBtn, closeBtn].forEach(btn => btn.addEventListener("click", closeMenu));

  return menu;
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
      <h2 id="account-setup-title">Configura tu cuenta</h2>
      <p>Escribe tu nombre y elige el tema de tu cuenta.</p>
      <label class="account-label" for="account-name-input">Nombre</label>
      <input id="account-name-input" class="account-input" type="text" maxlength="28" placeholder="Tu nombre" autocomplete="off" />

      <label class="account-label" for="account-theme-select">Tema</label>
      <div class="account-theme-picker" id="account-theme-picker">
        <button type="button" class="account-theme-option active" data-theme="dark">Oscuro</button>
        <button type="button" class="account-theme-option" data-theme="light">Claro</button>
      </div>

      <div id="account-setup-error" class="account-error"></div>
      <button id="account-save-btn" class="account-save-btn">Entrar</button>
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
        errorEl.textContent = "Debes escribir tu nombre.";
        nameInput.focus();
        return;
      }

      currentAccount = { name, theme };
      applyAccountTheme(theme);
      saveCurrentAccount();
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
        ? `<button class="sidebar-pl-delete" data-name="${escHtml(pl.name)}" title="Eliminar">${closeIcon(14)}</button>`
        : ""}
    `;

    li.addEventListener("click", e => {
      if ((e.target as HTMLElement).closest(".sidebar-pl-delete")) return;
      player.cambiarPlaylist(pl.name);
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
            <span class="main-header-type">PLAYLIST</span>
            <h1 class="main-header-title">${escHtml(pl.name)}</h1>
            <p class="main-header-meta">${pl.size} canciones &nbsp;·&nbsp; ${pl.formattedTotalDuration()}</p>
            <div class="main-header-actions">
              <button class="btn-play-big" id="btn-play-big">
                ${player.isPlaying && player.currentPlaylist === pl ? pauseIcon(28) : playIcon(28)}
              </button>
              <button class="btn-add-track" id="btn-view-queue">
                ${listIcon(16)} ${isQueuePanelOpen ? "Ocultar cola" : "Ver cola"}
              </button>
              <button class="btn-add-track" id="btn-add-track">
                ${plusIcon(16)} Agregar canción
              </button>
            </div>
          </div>
        </div>

        <!-- COLUMNAS -->
        <div class="tracks-table">
          <div class="tracks-thead">
            <span class="col-num">#</span>
            <span class="col-info">TÍTULO</span>
            <span class="col-dur">${clockIcon(14)}</span>
          </div>
          <ul class="tracks-tbody" id="tracks-tbody">
            ${tracks.length === 0
              ? `<li class="tracks-empty">
                   ${musicNoteIcon(40)}
                   <p>Esta playlist está vacía</p>
                   <span>Agrega canciones con el botón de arriba</span>
                 </li>`
              : tracks.map((t, i) => renderTrackRow(t, i, pl)).join("")
            }
          </ul>
        </div>
      </section>

      ${isQueuePanelOpen ? `
      <aside class="queue-sidebar">
        <div class="queue-sidebar-head">
          <h3>Cola</h3>
        </div>

        <div class="queue-block">
          <h4>Sonando</h4>
          ${nowPlayingTrack
            ? `<div class="queue-now-item">
                <div class="queue-now-cover">${musicNoteIcon(18)}</div>
                <div class="queue-now-copy">
                  <strong>${escHtml(nowPlayingTrack.title)}</strong>
                  <span>${escHtml(nowPlayingTrack.artist)}</span>
                </div>
              </div>`
            : `<div class="queue-empty">No hay canción seleccionada.</div>`}
        </div>

        <div class="queue-controls">
          <button class="queue-ctrl${hasPrevInQueue ? "" : " disabled"}" id="queue-prev">${skipPrevIcon()} Anterior</button>
          <button class="queue-ctrl${hasNextInQueue ? "" : " disabled"}" id="queue-next">Siguiente ${skipNextIcon()}</button>
        </div>

        <div class="queue-block">
          <h4>Siguiente de: ${escHtml(pl.name)}</h4>
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
          <input type="text" id="home-search-input" class="home-search-input" placeholder="¿Qué quieres reproducir?" value="${escHtml(homeSearchQuery)}" autocomplete="off" />
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

  document.getElementById("home-open-search")?.addEventListener("click", async () => {
    await openItunesSearchPrompt();
  });

  document.querySelectorAll<HTMLElement>("[data-playlist-name]").forEach(card => {
    card.addEventListener("click", () => {
      const playlist = player.playlists.find(pl => pl.name === card.dataset.playlistName);
      if (!playlist) return;
      player.cambiarPlaylist(playlist.name);
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
      player.cambiarPlaylist(playlist.name);
      viewMode = "playlist";
      const selectedTrack = playlist.current?.track ?? null;
      if (!selectedTrack) return;
      void preparePreviewPlayback(selectedTrack, true);
      renderAll();
    });
  });

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
        <h2>${homeSearchQuery.trim() ? "Resultados" : "Playlists destacadas"}</h2>
        <button class="home-link" id="home-open-search">Mostrar todos</button>
      </div>
      <div class="home-card-row">
        ${homeSearchQuery.trim()
          ? searchResults.length > 0
            ? searchResults.slice(0, 4).map(result => renderHomeTrackCard(result)).join("")
            : `<div class="home-empty-card">No hay coincidencias para "${escHtml(homeSearchQuery)}". Mostrando canciones disponibles.</div>`
          : featured.length > 0
          ? featured.map(pl => renderHomePlaylistCard(pl)).join("")
          : `<div class="home-empty-card">Usa Buscar para cargar playlists desde iTunes.</div>`}
      </div>
    </section>

    ${searchQuery ? `
    <section class="home-section">
      <div class="home-section-head">
        <h2>Canciones</h2>
      </div>
      <div class="home-track-results">
        ${searchResults.length > 0
          ? searchResults.map(result => renderHomeSearchResult(result)).join("")
          : hasLiveResults
          ? liveItunesTracks.map(track => renderLiveItunesResult(track, liveItunesCover)).join("")
          : liveItunesLoading
          ? `<div class="home-empty-card">Buscando en iTunes...</div>`
          : `<div class="home-empty-card">No se encontraron canciones.</div>`}
      </div>
    </section>
    ` : `
    <section class="home-section">
      <div class="home-section-head">
        <h2>Recientes</h2>
      </div>
      <div class="home-card-grid">
        ${recent.length > 0
          ? recent.map(pl => renderHomeRecentCard(pl)).join("")
          : `<div class="home-empty-card">Todavía no hay contenido reciente.</div>`}
      </div>
    </section>
    `}
  `;

  document.getElementById("home-open-search")?.addEventListener("click", async () => {
    await openItunesSearchPrompt();
  });

  document.querySelectorAll<HTMLElement>("[data-playlist-name]").forEach(card => {
    card.addEventListener("click", () => {
      const playlist = player.playlists.find(pl => pl.name === card.dataset.playlistName);
      if (!playlist) return;
      player.cambiarPlaylist(playlist.name);
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
      player.cambiarPlaylist(playlist.name);
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
        <span class="home-card-subtitle">Playlist · ${pl.size} canciones</span>
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
      <button class="home-result-heart${favorite ? " active" : ""}" data-favorite-track="${escHtml(result.track.title)}" title="${favorite ? "Quitar de favoritos" : "Agregar a favoritos"}">${favoriteIcon(favorite)}</button>
      <button class="home-result-play" title="Reproducir">${playIcon(18)}</button>
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
        <span>${escHtml(track.artist)} · iTunes</span>
      </div>
      <button class="home-result-heart${isTrackFavorite(track) ? " active" : ""}" data-favorite-track="${escHtml(track.title)}" title="${isTrackFavorite(track) ? "Quitar de favoritos" : "Agregar a favoritos"}">${favoriteIcon(isTrackFavorite(track))}</button>
      <button class="home-result-play" title="Reproducir preview">${playIcon(18)}</button>
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
        <span>${firstTrack ? escHtml(firstTrack.artist) : `Playlist · ${pl.size} canciones`}</span>
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
        <button class="track-favorite-btn${favorite ? " active" : ""}" data-favorite-title="${escHtml(track.title)}" title="${favorite ? "Quitar de favoritos" : "Agregar a favoritos"}">${favoriteIcon(favorite)}</button>
        <button class="track-delete-btn" data-title="${escHtml(track.title)}" title="Eliminar">
          ${trashIcon(15)}
        </button>
      </span>
    </li>
  `;
}

function renderQueueNodes(pl: Playlist): string {
  if (!pl.head) {
    return `<li class="queue-empty">La cola está vacía. Agrega canciones para navegar con anterior y siguiente.</li>`;
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
    return `<li class="queue-empty">La cola está vacía.</li>`;
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
    return `<li class="queue-empty">No hay próximas canciones en la cola.</li>`;
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
  const volumePct = Math.round(audioPlayer.volume * 100);

  footerEl.innerHTML = `
    <!-- NOW PLAYING -->
    <div class="footer-left">
      <div class="footer-cover">
        ${pl?.cover
          ? `<img src="${pl.cover}" alt="" onerror="this.style.display='none'">`
          : `<div class="footer-cover-fallback">${musicNoteIcon(22)}</div>`}
      </div>
      <div class="footer-track-info">
        <span class="footer-track-title">${track ? escHtml(track.title) : "Sin reproducción"}</span>
        <span class="footer-track-artist">${track ? escHtml(track.artist) : "—"}</span>
      </div>
      ${track ? `<button class="footer-heart${isTrackFavorite(track) ? " active" : ""}" id="footer-heart" title="${isTrackFavorite(track) ? "Quitar de favoritos" : "Agregar a favoritos"}">${favoriteIcon(isTrackFavorite(track))}</button>` : ""}
    </div>

    <!-- CONTROLS -->
    <div class="footer-center">
      <div class="footer-btns">
        <button class="footer-ctrl${hasPrev ? "" : " disabled"}" id="fc-prev" title="Anterior">${skipPrevIcon()}</button>
        <button class="footer-ctrl footer-play" id="fc-play">
          ${player.isPlaying ? pauseIcon(26) : playIcon(26)}
        </button>
        <button class="footer-ctrl${hasNext ? "" : " disabled"}" id="fc-next" title="Siguiente">${skipNextIcon()}</button>
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
    const t = player.next();
    if (t) { currentProgress = 0; currentTrackDuration = t.duration; if (player.isPlaying) startProgress(); }
    renderAll();
  });

  document.getElementById("fc-play")?.addEventListener("click", () => {
    if (!pl?.current) return;
    const selectedTrack = pl.current.track;
    if (!selectedTrack.previewUrl) {
      showToast("Esta canción no tiene preview disponible en iTunes.", "error");
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
    audioPlayer.volume = Math.max(0, Math.min(1, Number(volInput.value) / 100));
  });
}

// ═══════════════════════════════════════════════════════════
// MODAL — Agregar canción
// ═══════════════════════════════════════════════════════════
function openModal(): void {
  modalTitleInput.value = "";
  modalArtistInput.value = "";
  modalDurationInput.value = "";
  modalPositionInput.value = "";
  const size = player.currentPlaylist?.size ?? 0;
  modalPositionInput.placeholder = size > 0 ? `1 – ${size + 1} (vacío = al final)` : "Al final";
  modalEl.classList.add("open");
  modalOverlayEl.classList.add("open");
  modalTitleInput.focus();
}

function closeModal(): void {
  modalEl.classList.remove("open");
  modalOverlayEl.classList.remove("open");
}

modalCancelBtn.addEventListener("click", closeModal);
modalOverlayEl.addEventListener("click", closeModal);

modalSubmitBtn.addEventListener("click", () => {
  const pl = player.currentPlaylist;
  if (!pl) { showToast("Selecciona una playlist primero.", "error"); return; }

  const title  = modalTitleInput.value.trim();
  const artist = modalArtistInput.value.trim();
  const durStr = modalDurationInput.value.trim();
  const posStr = modalPositionInput.value.trim();

  if (!title || !artist) { showToast("Título y artista son obligatorios.", "error"); return; }

  let duration = 180;
  if (durStr) {
    if (durStr.includes(":")) {
      const [m, s] = durStr.split(":");
      duration = parseInt(m) * 60 + parseInt(s || "0");
    } else { duration = parseInt(durStr) || 180; }
  }

  const track = new Track(title, artist, duration);
  try {
    if (posStr) {
      const pos = parseInt(posStr) - 1;
      pl.addTrackAtPosition(track, pos);
      showToast(`"${title}" agregada en posición ${pos + 1}.`);
    } else {
      pl.addTrackToEnd(track);
      showToast(`"${title}" agregada.`);
    }
    closeModal();
    renderAll();
  } catch (err: any) {
    showToast(err.message, "error");
  }
});

// Enter en modal
[modalTitleInput, modalArtistInput, modalDurationInput, modalPositionInput].forEach(inp => {
  inp.addEventListener("keydown", e => { if (e.key === "Enter") modalSubmitBtn.click(); });
});

// ── Crear playlist ────────────────────────────────────────
newPlaylistBtn.addEventListener("click", () => {
  const name = newPlaylistInput.value.trim();
  if (!name) { showToast("Escribe un nombre.", "error"); return; }
  try {
    // Color aleatorio entre una paleta curada
    const colors = ["#6B3FA0","#C0392B","#1A6B8A","#2E7D32","#E67E22","#16A085","#8E44AD","#D35400"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    player.crearPlaylist(name, "", color);
    newPlaylistInput.value = "";
    showToast(`Playlist "${name}" creada.`);
    renderAll();
  } catch (err: any) { showToast(err.message, "error"); }
});

newPlaylistInput.addEventListener("keydown", e => { if (e.key === "Enter") newPlaylistBtn.click(); });

homeNavEl?.addEventListener("click", e => {
  e.preventDefault();
  viewMode = "home";
  isQueuePanelOpen = false;
  renderAll();
});

itunesSearchLinkEl?.addEventListener("click", async e => {
  e.preventDefault();
  await openItunesSearchPrompt();
});

async function openItunesSearchPrompt(): Promise<void> {
  const query = window.prompt("Buscar en iTunes", "")?.trim();
  if (!query) return;

  try {
    await importItunesPlaylistFromQuery(query);
  } catch (_err) {
    showToast("No se pudo consultar iTunes para esa búsqueda.", "error");
  }
}

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
    showToast(`"${title}" eliminada.`);
    renderAll();
  }
}

function handleDeletePlaylist(name: string): void {
  if (name === FAVORITES_PLAYLIST_NAME) {
    showToast("No puedes eliminar la playlist Mis favoritos.", "error");
    return;
  }
  if (player.playlists.length <= 1) { showToast("No puedes eliminar la única playlist.", "error"); return; }
  player.eliminarPlaylist(name);
  stopProgress();
  audioPlayer.removeAttribute("src");
  currentProgress = 0;
  player.isPlaying = false;
  if (viewMode === "playlist" && player.currentPlaylist?.name === name) {
    viewMode = "home";
    isQueuePanelOpen = false;
  }
  showToast(`Playlist "${name}" eliminada.`);
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
        showToast("No se pudo reproducir el preview de esta canción.", "error");
        renderAll();
      });
    }
    return;
  }

  if (currentTrackDuration === 0) return;
  progressInterval = window.setInterval(() => {
    currentProgress++;
    if (currentProgress >= currentTrackDuration) {
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
  const storedAccount = loadStoredAccount();
  if (storedAccount) {
    currentAccount = storedAccount;
    applyAccountTheme(storedAccount.theme);
  } else {
    await promptAccountSetup();
  }

  await initSampleData();
  renderAll();
}

bootstrap();
