/**
 * sw.js — SwingDJ PWA Service Worker
 * 온라인 시 최신 리소스를 우선 가져오고(Network-First), 오프라인(지하 스윙 빠 등)에서는 캐시로 즉시 동작합니다.
 */
const CACHE_NAME = 'swing-dj-v6';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './styles/main.css',
  './styles/player.css',
  './styles/playlist.css',
  './styles/equalizer.css',
  './styles/profile.css',
  './src/main.js',
  './src/audio/AudioEngine.js',
  './src/audio/Player.js',
  './src/audio/CuePlayer.js',
  './src/audio/BPMDetector.js',
  './src/audio/BPMWorker.js',
  './src/audio/Metronome.js',
  './src/playlist/PlaylistManager.js',
  './src/playlist/QueueManager.js',
  './src/ui/PlayerUI.js',
  './src/ui/PlaylistUI.js',
  './src/ui/QueueUI.js',
  './src/ui/EQPanel.js',
  './src/ui/DJToolsUI.js',
  './src/ui/DeviceSelector.js',
  './src/ui/ProfileUI.js',
  './src/ui/BPMPopover.js',
  './src/ui/HelpModal.js',
  './src/utils/Storage.js',
  './src/utils/FileLoader.js',
  './src/utils/TimeFormatter.js',
  './src/utils/ProfileManager.js',
  './src/utils/BPMTier.js',
  './src/utils/ThemeManager.js',
  './src/utils/Toast.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
