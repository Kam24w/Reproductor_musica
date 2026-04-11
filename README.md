# 🎵 Melodify — Reproductor de Música con Listas Doblemente Enlazadas

## Descripción

Aplicación de reproductor de música estilo Spotify que implementa **listas doblemente enlazadas** como estructura de datos principal para la gestión de playlists y navegación entre canciones.

---

## Estructura del Proyecto

```
music-player/
├── index.html        # Interfaz HTML
├── styles.css        # Estilos (tema oscuro estilo Spotify)
├── tsconfig.json     # Configuración TypeScript
├── package.json
├── src/
│   ├── models.ts     # Lógica de dominio (Track, PlaylistNode, Playlist, MusicPlayer)
│   └── app.ts        # Controlador de UI (DOM)
├── models.js         # TS compilado
└── app.js            # TS compilado
```

---

## Cómo Ejecutar

### Opción 1 — Sin servidor (más simple)

Abre `index.html` directamente en un navegador moderno (Chrome, Firefox, Edge).

> ⚠️ Si hay problemas con módulos ES, usa la Opción 2.

### Opción 2 — Con servidor local (recomendado)

**Con Node.js + npx:**
```bash
cd music-player
npx serve .
# Abre http://localhost:3000
```

**Con Python:**
```bash
cd music-player
python3 -m http.server 8080
# Abre http://localhost:8080
```

### Recompilar TypeScript

```bash
cd music-player
npm install          # Solo la primera vez
npx tsc              # Compilar
npx tsc --watch      # Modo desarrollo (recarga automática)
```

---

## Estructura de Datos Implementada

### `Track` — Canción
```ts
class Track {
  title: string
  artist: string
  duration: number       // en segundos
  formattedDuration()    // "3:45"
}
```

### `PlaylistNode` — Nodo de la lista
```ts
class PlaylistNode {
  track: Track
  next: PlaylistNode | null    // siguiente canción
  prev: PlaylistNode | null    // canción anterior
}
```

### `Playlist` — Lista doblemente enlazada
```ts
class Playlist {
  head: PlaylistNode | null    // primer nodo
  tail: PlaylistNode | null    // último nodo
  current: PlaylistNode | null // canción activa

  addTrackToStart(track)
  addTrackToEnd(track)
  addTrackAtPosition(track, position)
  removeTrack(title)
  playNext()
  playPrevious()
  getTracks(): Track[]         // solo para la UI
}
```

### `MusicPlayer` — Gestor de playlists
```ts
class MusicPlayer {
  playlists: Playlist[]
  currentPlaylist: Playlist | null

  crearPlaylist(nombre)
  cambiarPlaylist(nombre)
  eliminarPlaylist(nombre)
  togglePlay()
  next()
  previous()
}
```

---

## Casos Borde Manejados

| Caso | Comportamiento |
|------|----------------|
| Lista vacía al navegar | No hace nada, sin error |
| Un solo elemento | head = tail, next/prev son null |
| Eliminar head | El siguiente se convierte en head, prev = null |
| Eliminar tail | El anterior se convierte en tail, next = null |
| Eliminar canción activa | current avanza al siguiente o retrocede |
| Posición inválida | Lanza RangeError con mensaje claro |
| Playlist sin nombre | Lanza Error con validación |
| Playlist duplicada | Lanza Error informativo |

---

## Funcionalidades de la UI

- ✅ Crear y eliminar playlists
- ✅ Agregar canciones al final, inicio o posición específica
- ✅ Eliminar canciones
- ✅ Navegar entre canciones (⏮ ⏭)
- ✅ Reproducir / Pausar con barra de progreso simulada
- ✅ Avance automático de canción al terminar
- ✅ Clic en la barra de progreso para saltar
- ✅ Control de volumen visual
- ✅ Ecualizador animado en canción activa
- ✅ Toasts de notificación
- ✅ Estado vacío ilustrado
