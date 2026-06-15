/* Service worker: cache the app shell so the PWA loads instantly and works
   offline. App data (API calls under /api) is always fetched from the network
   and is never cached. */
var CACHE = "blocks-shell-v1";
var SHELL = [
	".",
	"index.html",
	"styles.css",
	"app.js",
	"manifest.webmanifest",
	"icons/icon.svg"
];

self.addEventListener("install", function(event) {
	event.waitUntil(
		caches.open(CACHE).then(function(cache) { return cache.addAll(SHELL); })
			.then(function() { return self.skipWaiting(); })
	);
});

self.addEventListener("activate", function(event) {
	event.waitUntil(
		caches.keys().then(function(keys) {
			return Promise.all(keys.map(function(k) {
				if (k !== CACHE) { return caches.delete(k); }
			}));
		}).then(function() { return self.clients.claim(); })
	);
});

self.addEventListener("fetch", function(event) {
	var req = event.request;
	if (req.method !== "GET") { return; }
	var url = new URL(req.url);

	// Never cache API traffic — always go to the network.
	if (url.pathname.indexOf("/api/") === 0) { return; }

	// App shell: cache-first, falling back to network.
	event.respondWith(
		caches.match(req).then(function(cached) {
			return cached || fetch(req).then(function(res) {
				if (res && res.ok && url.origin === self.location.origin) {
					var copy = res.clone();
					caches.open(CACHE).then(function(c) { c.put(req, copy); });
				}
				return res;
			}).catch(function() { return cached; });
		})
	);
});
