// ============================================================
// DOMAIN MODELS — Melodify Music Player
// ============================================================

class Track {
  title: string;
  artist: string;
  duration: number;
  previewUrl: string;

  constructor(title: string, artist: string, duration: number, previewUrl = "") {
    this.title = title;
    this.artist = artist;
    this.duration = duration;
    this.previewUrl = previewUrl;
  }

  formattedDuration(): string {
    const mins = Math.floor(this.duration / 60);
    const secs = this.duration % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}

class PlaylistEntry {
  track: Track;
  next: PlaylistEntry | null;
  prev: PlaylistEntry | null;

  constructor(track: Track) {
    this.track = track;
    this.next = null;
    this.prev = null;
  }
}

class Playlist {
  name: string;
  cover: string;
  color: string;
  head: PlaylistEntry | null;
  tail: PlaylistEntry | null;
  current: PlaylistEntry | null;
  private _size: number;

  constructor(name: string, cover = "", color = "#1a3a20") {
    this.name = name;
    this.cover = cover;
    this.color = color;
    this.head = null;
    this.tail = null;
    this.current = null;
    this._size = 0;
  }

  get size(): number { return this._size; }
  get isEmpty(): boolean { return this._size === 0; }

  addTrackToStart(track: Track): void {
    const entry = new PlaylistEntry(track);
    if (this.isEmpty) { this.head = this.tail = this.current = entry; }
    else { entry.next = this.head; this.head!.prev = entry; this.head = entry; }
    this._size++;
  }

  addTrackToEnd(track: Track): void {
    const entry = new PlaylistEntry(track);
    if (this.isEmpty) { this.head = this.tail = this.current = entry; }
    else { entry.prev = this.tail; this.tail!.next = entry; this.tail = entry; }
    this._size++;
  }

  addTrackAtPosition(track: Track, position: number): void {
    if (position < 0 || position > this._size)
      throw new RangeError(`Posición ${position} inválida. Rango: 0–${this._size}`);
    if (position === 0) { this.addTrackToStart(track); return; }
    if (position === this._size) { this.addTrackToEnd(track); return; }
    let cur = this.head;
    for (let i = 0; i < position; i++) cur = cur!.next;
    const entry = new PlaylistEntry(track);
    const prev = cur!.prev!;
    entry.next = cur; entry.prev = prev;
    prev.next = entry; cur!.prev = entry;
    this._size++;
  }

  removeTrack(title: string): boolean {
    if (this.isEmpty) return false;
    let entry = this.head;
    while (entry && entry.track.title !== title) entry = entry.next;
    if (!entry) return false;
    if (this.current === entry) this.current = entry.next ?? entry.prev ?? null;
    if (this._size === 1) { this.head = this.tail = this.current = null; this._size--; return true; }
    if (entry === this.head) { this.head = entry.next; this.head!.prev = null; }
    else if (entry === this.tail) { this.tail = entry.prev; this.tail!.next = null; }
    else { entry.prev!.next = entry.next; entry.next!.prev = entry.prev; }
    entry.next = entry.prev = null;
    this._size--;
    return true;
  }

  playNext(): Track | null {
    if (!this.current?.next) return null;
    this.current = this.current.next;
    return this.current.track;
  }

  playPrevious(): Track | null {
    if (!this.current?.prev) return null;
    this.current = this.current.prev;
    return this.current.track;
  }

  selectTrack(title: string): boolean {
    let entry = this.head;
    while (entry) { if (entry.track.title === title) { this.current = entry; return true; } entry = entry.next; }
    return false;
  }

  getTracks(): Track[] {
    const tracks: Track[] = [];
    let entry = this.head;
    while (entry) { tracks.push(entry.track); entry = entry.next; }
    return tracks;
  }

  totalDuration(): number {
    let t = 0, entry = this.head;
    while (entry) { t += entry.track.duration; entry = entry.next; }
    return t;
  }

  formattedTotalDuration(): string {
    const t = this.totalDuration();
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
    return h > 0 ? `${h} hr ${m} min` : `${m} min`;
  }
}

class MusicPlayer {
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
  isPlaying: boolean;

  constructor() { this.playlists = []; this.currentPlaylist = null; this.isPlaying = false; }

  createPlaylist(name: string, cover = "", color = "#1a3a20"): Playlist {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("playlist_name_required");
    if (this.playlists.find(p => p.name === cleanName)) throw new Error("playlist_name_exists");
    const p = new Playlist(cleanName, cover, color);
    this.playlists.push(p);
    if (!this.currentPlaylist) this.currentPlaylist = p;
    return p;
  }

  switchPlaylist(name: string): boolean {
    const p = this.playlists.find(p => p.name === name);
    if (!p) return false;
    this.currentPlaylist = p; this.isPlaying = false; return true;
  }

  removePlaylist(name: string): boolean {
    const i = this.playlists.findIndex(p => p.name === name);
    if (i === -1) return false;
    const wasActive = this.currentPlaylist?.name === name;
    this.playlists.splice(i, 1);
    if (wasActive) { this.currentPlaylist = this.playlists[0] ?? null; this.isPlaying = false; }
    return true;
  }

  togglePlay(): boolean {
    if (!this.currentPlaylist?.current) return false;
    this.isPlaying = !this.isPlaying; return this.isPlaying;
  }

  next(): Track | null {
    if (!this.currentPlaylist) return null;
    const t = this.currentPlaylist.playNext();
    if (t) this.isPlaying = true; return t;
  }

  previous(): Track | null {
    if (!this.currentPlaylist) return null;
    const t = this.currentPlaylist.playPrevious();
    if (t) this.isPlaying = true; return t;
  }
}
