// ============================================================
// MODELOS DE DOMINIO — Reproductor de Música
// ============================================================

export class Track {
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

export class PlaylistNode {
  track: Track;
  next: PlaylistNode | null;
  prev: PlaylistNode | null;

  constructor(track: Track) {
    this.track = track;
    this.next = null;
    this.prev = null;
  }
}

export class Playlist {
  name: string;
  cover: string;
  color: string;
  head: PlaylistNode | null;
  tail: PlaylistNode | null;
  current: PlaylistNode | null;
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
    const node = new PlaylistNode(track);
    if (this.isEmpty) { this.head = this.tail = this.current = node; }
    else { node.next = this.head; this.head!.prev = node; this.head = node; }
    this._size++;
  }

  addTrackToEnd(track: Track): void {
    const node = new PlaylistNode(track);
    if (this.isEmpty) { this.head = this.tail = this.current = node; }
    else { node.prev = this.tail; this.tail!.next = node; this.tail = node; }
    this._size++;
  }

  addTrackAtPosition(track: Track, position: number): void {
    if (position < 0 || position > this._size)
      throw new RangeError(`Posición ${position} inválida. Rango: 0–${this._size}`);
    if (position === 0) { this.addTrackToStart(track); return; }
    if (position === this._size) { this.addTrackToEnd(track); return; }
    let cur = this.head;
    for (let i = 0; i < position; i++) cur = cur!.next;
    const node = new PlaylistNode(track);
    const prev = cur!.prev!;
    node.next = cur; node.prev = prev;
    prev.next = node; cur!.prev = node;
    this._size++;
  }

  removeTrack(title: string): boolean {
    if (this.isEmpty) return false;
    let node = this.head;
    while (node && node.track.title !== title) node = node.next;
    if (!node) return false;
    if (this.current === node) this.current = node.next ?? node.prev ?? null;
    if (this._size === 1) { this.head = this.tail = this.current = null; this._size--; return true; }
    if (node === this.head) { this.head = node.next; this.head!.prev = null; }
    else if (node === this.tail) { this.tail = node.prev; this.tail!.next = null; }
    else { node.prev!.next = node.next; node.next!.prev = node.prev; }
    node.next = node.prev = null;
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
    let node = this.head;
    while (node) { if (node.track.title === title) { this.current = node; return true; } node = node.next; }
    return false;
  }

  getTracks(): Track[] {
    const tracks: Track[] = [];
    let node = this.head;
    while (node) { tracks.push(node.track); node = node.next; }
    return tracks;
  }

  totalDuration(): number {
    let t = 0, node = this.head;
    while (node) { t += node.track.duration; node = node.next; }
    return t;
  }

  formattedTotalDuration(): string {
    const t = this.totalDuration();
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
    return h > 0 ? `${h} hr ${m} min` : `${m} min`;
  }
}

export class MusicPlayer {
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
