// ============================================================
// MODELOS DE DOMINIO — Reproductor de Música
// ============================================================
export class Track {
    constructor(title, artist, duration, previewUrl = "") {
        this.title = title;
        this.artist = artist;
        this.duration = duration;
        this.previewUrl = previewUrl;
    }
    formattedDuration() {
        const mins = Math.floor(this.duration / 60);
        const secs = this.duration % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
}
export class PlaylistNode {
    constructor(track) {
        this.track = track;
        this.next = null;
        this.prev = null;
    }
}
export class Playlist {
    constructor(name, cover = "", color = "#1a3a20") {
        this.name = name;
        this.cover = cover;
        this.color = color;
        this.head = null;
        this.tail = null;
        this.current = null;
        this._size = 0;
    }
    get size() { return this._size; }
    get isEmpty() { return this._size === 0; }
    addTrackToStart(track) {
        const node = new PlaylistNode(track);
        if (this.isEmpty) {
            this.head = this.tail = this.current = node;
        }
        else {
            node.next = this.head;
            this.head.prev = node;
            this.head = node;
        }
        this._size++;
    }
    addTrackToEnd(track) {
        const node = new PlaylistNode(track);
        if (this.isEmpty) {
            this.head = this.tail = this.current = node;
        }
        else {
            node.prev = this.tail;
            this.tail.next = node;
            this.tail = node;
        }
        this._size++;
    }
    addTrackAtPosition(track, position) {
        if (position < 0 || position > this._size)
            throw new RangeError(`Posición ${position} inválida. Rango: 0–${this._size}`);
        if (position === 0) {
            this.addTrackToStart(track);
            return;
        }
        if (position === this._size) {
            this.addTrackToEnd(track);
            return;
        }
        let cur = this.head;
        for (let i = 0; i < position; i++)
            cur = cur.next;
        const node = new PlaylistNode(track);
        const prev = cur.prev;
        node.next = cur;
        node.prev = prev;
        prev.next = node;
        cur.prev = node;
        this._size++;
    }
    removeTrack(title) {
        if (this.isEmpty)
            return false;
        let node = this.head;
        while (node && node.track.title !== title)
            node = node.next;
        if (!node)
            return false;
        if (this.current === node)
            this.current = node.next ?? node.prev ?? null;
        if (this._size === 1) {
            this.head = this.tail = this.current = null;
            this._size--;
            return true;
        }
        if (node === this.head) {
            this.head = node.next;
            this.head.prev = null;
        }
        else if (node === this.tail) {
            this.tail = node.prev;
            this.tail.next = null;
        }
        else {
            node.prev.next = node.next;
            node.next.prev = node.prev;
        }
        node.next = node.prev = null;
        this._size--;
        return true;
    }
    playNext() {
        if (!this.current?.next)
            return null;
        this.current = this.current.next;
        return this.current.track;
    }
    playPrevious() {
        if (!this.current?.prev)
            return null;
        this.current = this.current.prev;
        return this.current.track;
    }
    selectTrack(title) {
        let node = this.head;
        while (node) {
            if (node.track.title === title) {
                this.current = node;
                return true;
            }
            node = node.next;
        }
        return false;
    }
    getTracks() {
        const tracks = [];
        let node = this.head;
        while (node) {
            tracks.push(node.track);
            node = node.next;
        }
        return tracks;
    }
    totalDuration() {
        let t = 0, node = this.head;
        while (node) {
            t += node.track.duration;
            node = node.next;
        }
        return t;
    }
    formattedTotalDuration() {
        const t = this.totalDuration();
        const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
        return h > 0 ? `${h} hr ${m} min` : `${m} min`;
    }
}
export class MusicPlayer {
    constructor() { this.playlists = []; this.currentPlaylist = null; this.isPlaying = false; }
    createPlaylist(name, cover = "", color = "#1a3a20") {
        const cleanName = name.trim();
        if (!cleanName)
            throw new Error("playlist_name_required");
        if (this.playlists.find(p => p.name === cleanName))
            throw new Error("playlist_name_exists");
        const p = new Playlist(cleanName, cover, color);
        this.playlists.push(p);
        if (!this.currentPlaylist)
            this.currentPlaylist = p;
        return p;
    }
    switchPlaylist(name) {
        const p = this.playlists.find(p => p.name === name);
        if (!p)
            return false;
        this.currentPlaylist = p;
        this.isPlaying = false;
        return true;
    }
    removePlaylist(name) {
        const i = this.playlists.findIndex(p => p.name === name);
        if (i === -1)
            return false;
        const wasActive = this.currentPlaylist?.name === name;
        this.playlists.splice(i, 1);
        if (wasActive) {
            this.currentPlaylist = this.playlists[0] ?? null;
            this.isPlaying = false;
        }
        return true;
    }
    togglePlay() {
        if (!this.currentPlaylist?.current)
            return false;
        this.isPlaying = !this.isPlaying;
        return this.isPlaying;
    }
    next() {
        if (!this.currentPlaylist)
            return null;
        const t = this.currentPlaylist.playNext();
        if (t)
            this.isPlaying = true;
        return t;
    }
    previous() {
        if (!this.currentPlaylist)
            return null;
        const t = this.currentPlaylist.playPrevious();
        if (t)
            this.isPlaying = true;
        return t;
    }
}
