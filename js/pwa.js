// pwa.js: hosted build only. Registers the offline service worker.
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('shot')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
