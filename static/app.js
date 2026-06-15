"use strict";

/* ===========================================================================
   100 Blocks a Day
   Works in two modes:
     - "remote": signed in, plans + settings synced via the FastAPI backend.
     - "local":  no backend reachable (or chosen explicitly), state in
                 localStorage on this device (the original behaviour).
   =========================================================================== */

var TOTAL_BLOCKS = 100;
var MINUTES_PER_BLOCK = 10; // 100 x 10 min = the ~16h40m waking day

var CATEGORIES = [
	{ id: "erase",   label: "Erase",   color: null },
	{ id: "sleep",   label: "Sleep",   color: "#5b6bd6" },
	{ id: "work",    label: "Work",    color: "#3aa0ff" },
	{ id: "health",  label: "Health",  color: "#2bb673" },
	{ id: "eat",     label: "Eat",     color: "#f5a623" },
	{ id: "social",  label: "Social",  color: "#ec5f9b" },
	{ id: "leisure", label: "Leisure", color: "#9b59d6" },
	{ id: "chores",  label: "Chores",  color: "#8a93a8" }
];

function colorOf(id) {
	for (var i = 0; i < CATEGORIES.length; i++) {
		if (CATEGORIES[i].id === id) { return CATEGORIES[i].color; }
	}
	return null;
}

function pad(n) { return n < 10 ? "0" + n : "" + n; }

function dateToStr(d) {
	return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function todayStr() { return dateToStr(new Date()); }

/* ---------------------------------------------------------------------------
   Storage backends
   --------------------------------------------------------------------------- */
var LocalStore = {
	planKey: function(date) { return "blocks-" + date; },
	loadDay: function(date) {
		try {
			var raw = localStorage.getItem(this.planKey(date));
			return Promise.resolve(raw ? JSON.parse(raw) : {});
		} catch (e) { return Promise.resolve({}); }
	},
	saveDay: function(date, blocks) {
		try {
			if (Object.keys(blocks).length === 0) {
				localStorage.removeItem(this.planKey(date));
			} else {
				localStorage.setItem(this.planKey(date), JSON.stringify(blocks));
			}
		} catch (e) { /* ignore */ }
		return Promise.resolve();
	},
	loadSettings: function() {
		var v = null;
		try { v = localStorage.getItem("day-start"); } catch (e) { /* ignore */ }
		return Promise.resolve({ day_start: v || "06:00" });
	},
	saveSettings: function(dayStart) {
		try { localStorage.setItem("day-start", dayStart); } catch (e) { /* ignore */ }
		return Promise.resolve();
	},
	listDays: function() {
		var out = [];
		try {
			for (var i = 0; i < localStorage.length; i++) {
				var key = localStorage.key(i);
				var m = key && key.match(/^blocks-(\d{4}-\d{2}-\d{2})$/);
				if (m) {
					var blocks = JSON.parse(localStorage.getItem(key) || "{}");
					var n = Object.keys(blocks).length;
					if (n > 0) { out.push({ date: m[1], count: n }); }
				}
			}
		} catch (e) { /* ignore */ }
		out.sort(function(a, b) { return a.date < b.date ? 1 : -1; });
		return Promise.resolve(out);
	}
};

function api(path, options) {
	options = options || {};
	options.credentials = "same-origin";
	options.headers = options.headers || {};
	if (options.body) { options.headers["Content-Type"] = "application/json"; }
	return fetch(path, options).then(function(res) {
		if (res.status === 204) { return null; }
		return res.json().catch(function() { return null; }).then(function(data) {
			if (!res.ok) {
				var err = new Error((data && data.detail) || ("Request failed (" + res.status + ")"));
				err.status = res.status;
				throw err;
			}
			return data;
		});
	});
}

var RemoteStore = {
	loadDay: function(date) {
		return api("/api/days/" + date).then(function(d) { return (d && d.blocks) || {}; });
	},
	saveDay: function(date, blocks) {
		return api("/api/days/" + date, { method: "PUT", body: JSON.stringify({ blocks: blocks }) });
	},
	loadSettings: function() {
		return api("/api/me").then(function(u) { return { day_start: (u && u.day_start) || "06:00" }; });
	},
	saveSettings: function(dayStart) {
		return api("/api/settings", { method: "PUT", body: JSON.stringify({ day_start: dayStart }) });
	},
	listDays: function() { return api("/api/days"); }
};

/* ---------------------------------------------------------------------------
   App state
   --------------------------------------------------------------------------- */
var store = LocalStore;
var mode = "local";          // "local" | "remote"
var currentDate = todayStr();
var plan = {};               // blocks for currentDate
var activeCategory = "sleep";
var dayStartMinutes = 6 * 60;
var isPainting = false;
var saveTimer = null;

var $ = function(id) { return document.getElementById(id); };

/* ---------------------------------------------------------------------------
   Clock + current-block highlight
   --------------------------------------------------------------------------- */
function tick() {
	var now = new Date();
	$("time").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
	$("date").textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
	updateCurrentBlock(now);
	setTimeout(tick, 500);
}

function currentBlockIndex(now) {
	var minutesIntoDay = (now.getHours() * 60 + now.getMinutes()) - dayStartMinutes;
	if (minutesIntoDay < 0) { minutesIntoDay += 24 * 60; }
	var idx = Math.floor(minutesIntoDay / MINUTES_PER_BLOCK);
	return (idx >= 0 && idx < TOTAL_BLOCKS) ? idx : -1;
}

function updateCurrentBlock(now) {
	var label = $("now-label");
	var prev = document.querySelector(".block.now");
	// only show "now" while viewing today
	if (currentDate !== todayStr()) {
		if (prev) { prev.classList.remove("now"); }
		label.textContent = "";
		return;
	}
	var idx = currentBlockIndex(now);
	if (idx < 0) {
		if (prev) { prev.classList.remove("now"); }
		label.textContent = "(outside your day)";
		return;
	}
	var target = document.querySelector('.block[data-idx="' + idx + '"]');
	if (prev && prev !== target) { prev.classList.remove("now"); }
	if (target) { target.classList.add("now"); }
	label.textContent = "· now on block " + (idx + 1);
}

/* ---------------------------------------------------------------------------
   Blocks + painting
   --------------------------------------------------------------------------- */
function buildBlocks() {
	var allBlocks = $("all-blocks");
	for (var i = 0; i < TOTAL_BLOCKS; i++) {
		var block = document.createElement("div");
		block.className = "block";
		block.setAttribute("data-idx", i);
		block.title = "Block " + (i + 1);
		allBlocks.appendChild(block);
	}
}

function renderPlan() {
	var blocks = document.querySelectorAll(".block");
	for (var i = 0; i < blocks.length; i++) {
		var node = blocks[i];
		var color = colorOf(plan[node.getAttribute("data-idx")]);
		if (color) {
			node.style.backgroundColor = color;
			node.classList.add("filled");
		} else {
			node.style.backgroundColor = "";
			node.classList.remove("filled");
		}
	}
}

function applyToBlock(node) {
	var idx = node.getAttribute("data-idx");
	var color = colorOf(activeCategory);
	if (activeCategory === "erase" || color === null) {
		delete plan[idx];
		node.style.backgroundColor = "";
		node.classList.remove("filled");
	} else {
		plan[idx] = activeCategory;
		node.style.backgroundColor = color;
		node.classList.add("filled");
	}
}

function blockUnderPoint(x, y) {
	var el = document.elementFromPoint(x, y);
	return el && el.classList && el.classList.contains("block") ? el : null;
}

function setupPainting() {
	var grid = $("all-blocks");
	grid.addEventListener("pointerdown", function(e) {
		var node = blockUnderPoint(e.clientX, e.clientY);
		if (!node) { return; }
		isPainting = true;
		applyToBlock(node);
		e.preventDefault();
	});
	grid.addEventListener("pointermove", function(e) {
		if (!isPainting) { return; }
		var node = blockUnderPoint(e.clientX, e.clientY);
		if (node) { applyToBlock(node); }
		e.preventDefault();
	});
	function endPaint() {
		if (!isPainting) { return; }
		isPainting = false;
		persistPlan();
		updateSummary();
	}
	document.addEventListener("pointerup", endPaint);
	document.addEventListener("pointercancel", endPaint);
}

function persistPlan() {
	var date = currentDate;
	var snapshot = JSON.parse(JSON.stringify(plan));
	// debounce so a flurry of edits results in one save
	clearTimeout(saveTimer);
	saveTimer = setTimeout(function() {
		store.saveDay(date, snapshot).then(refreshHistory).catch(function() { /* ignore */ });
	}, 400);
}

/* ---------------------------------------------------------------------------
   Summary
   --------------------------------------------------------------------------- */
function updateSummary() {
	var counts = {};
	var used = 0;
	Object.keys(plan).forEach(function(idx) {
		counts[plan[idx]] = (counts[plan[idx]] || 0) + 1;
		used++;
	});

	var summary = $("summary");
	summary.innerHTML = "";

	CATEGORIES.forEach(function(cat) {
		if (cat.id === "erase" || !counts[cat.id]) { return; }
		var n = counts[cat.id];
		var mins = n * MINUTES_PER_BLOCK;
		var label = n + " · " + Math.floor(mins / 60) + "h" + pad(mins % 60);
		var stat = document.createElement("div");
		stat.className = "stat";
		var dot = document.createElement("span");
		dot.className = "dot";
		dot.style.backgroundColor = cat.color;
		stat.appendChild(dot);
		var text = document.createElement("span");
		text.textContent = cat.label + ": " + label;
		stat.appendChild(text);
		summary.appendChild(stat);
	});

	var total = document.createElement("div");
	total.className = "stat total";
	var totalText = document.createElement("span");
	totalText.textContent = used + " / " + TOTAL_BLOCKS + " blocks planned";
	total.appendChild(totalText);
	summary.appendChild(total);
}

/* ---------------------------------------------------------------------------
   Palette
   --------------------------------------------------------------------------- */
function buildPalette() {
	var palette = $("palette");
	CATEGORIES.forEach(function(cat) {
		var btn = document.createElement("button");
		btn.type = "button";
		btn.className = cat.id === "erase" ? "swatch erase" : "swatch";
		btn.setAttribute("data-cat", cat.id);
		btn.setAttribute("aria-pressed", cat.id === activeCategory ? "true" : "false");
		btn.addEventListener("click", function() { setActive(cat.id); });
		var dot = document.createElement("span");
		dot.className = "dot";
		if (cat.color) { dot.style.backgroundColor = cat.color; }
		btn.appendChild(dot);
		var text = document.createElement("span");
		text.textContent = cat.label;
		btn.appendChild(text);
		palette.appendChild(btn);
	});
}

function setActive(id) {
	activeCategory = id;
	var swatches = document.querySelectorAll(".swatch");
	for (var i = 0; i < swatches.length; i++) {
		swatches[i].setAttribute("aria-pressed",
			swatches[i].getAttribute("data-cat") === id ? "true" : "false");
	}
}

/* ---------------------------------------------------------------------------
   Date navigation + history
   --------------------------------------------------------------------------- */
function shiftDate(days) {
	var d = new Date(currentDate + "T00:00:00");
	d.setDate(d.getDate() + days);
	goToDate(dateToStr(d));
}

function goToDate(date) {
	currentDate = date;
	$("date-picker").value = date;
	var tag = $("today-tag");
	if (date === todayStr()) {
		tag.textContent = "Today";
		tag.className = "today-tag is-today";
	} else {
		tag.textContent = "";
		tag.className = "today-tag";
	}
	store.loadDay(date).then(function(blocks) {
		plan = blocks || {};
		renderPlan();
		updateSummary();
		updateCurrentBlock(new Date());
		highlightHistory();
	});
}

function refreshHistory() {
	return store.listDays().then(function(days) {
		var list = $("history");
		list.innerHTML = "";
		if (!days || days.length === 0) {
			var empty = document.createElement("div");
			empty.className = "history-empty";
			empty.textContent = "No saved days yet — plan one above and it'll show up here.";
			list.appendChild(empty);
			return;
		}
		days.forEach(function(day) {
			var row = document.createElement("div");
			row.className = "history-row";
			row.setAttribute("data-date", day.date);
			if (day.date === currentDate) { row.classList.add("active"); }
			var when = document.createElement("span");
			var d = new Date(day.date + "T00:00:00");
			when.textContent = d.toLocaleDateString(undefined,
				{ weekday: "short", year: "numeric", month: "short", day: "numeric" });
			var count = document.createElement("span");
			count.className = "count";
			count.textContent = day.count + " blocks";
			row.appendChild(when);
			row.appendChild(count);
			row.addEventListener("click", function() { goToDate(day.date); });
			list.appendChild(row);
		});
	}).catch(function() { /* ignore */ });
}

function highlightHistory() {
	var rows = document.querySelectorAll(".history-row");
	for (var i = 0; i < rows.length; i++) {
		rows[i].classList.toggle("active", rows[i].getAttribute("data-date") === currentDate);
	}
}

/* ---------------------------------------------------------------------------
   Settings (day start)
   --------------------------------------------------------------------------- */
function applyDayStart(value) {
	var parts = value.split(":");
	if (parts.length === 2) {
		dayStartMinutes = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
	}
	updateCurrentBlock(new Date());
}

function setupDayStart() {
	var input = $("day-start");
	input.addEventListener("change", function() {
		applyDayStart(input.value);
		store.saveSettings(input.value);
	});
}

/* ---------------------------------------------------------------------------
   Account / auth UI
   --------------------------------------------------------------------------- */
var backendAvailable = false;
var authMode = "login";

function renderAccount(username) {
	var el = $("account");
	el.innerHTML = "";
	if (mode === "remote" && username) {
		var who = document.createElement("span");
		who.innerHTML = "Signed in as <span class=\"who\"></span>";
		who.querySelector(".who").textContent = username;
		var out = document.createElement("button");
		out.textContent = "Sign out";
		out.addEventListener("click", logout);
		el.appendChild(who);
		el.appendChild(out);
	} else if (backendAvailable) {
		var note = document.createElement("span");
		note.textContent = "Local mode (this device only)";
		var signin = document.createElement("button");
		signin.textContent = "Sign in to sync";
		signin.addEventListener("click", showAuth);
		el.appendChild(note);
		el.appendChild(signin);
	} else {
		el.textContent = "";
	}
}

function showAuth() { $("auth-overlay").hidden = false; }
function hideAuth() { $("auth-overlay").hidden = true; $("auth-error").textContent = ""; }

function setupAuthForm() {
	function selectTab(m) {
		authMode = m;
		$("tab-login").setAttribute("aria-selected", m === "login" ? "true" : "false");
		$("tab-register").setAttribute("aria-selected", m === "register" ? "true" : "false");
		$("auth-submit").textContent = m === "login" ? "Sign in" : "Create account";
		$("auth-password").autocomplete = m === "login" ? "current-password" : "new-password";
		$("auth-error").textContent = "";
	}
	$("tab-login").addEventListener("click", function() { selectTab("login"); });
	$("tab-register").addEventListener("click", function() { selectTab("register"); });

	$("auth-form").addEventListener("submit", function(e) {
		e.preventDefault();
		var creds = {
			username: $("auth-username").value.trim(),
			password: $("auth-password").value
		};
		var path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
		api(path, { method: "POST", body: JSON.stringify(creds) }).then(function(user) {
			hideAuth();
			enterRemoteMode(user);
		}).catch(function(err) {
			$("auth-error").textContent = err.message || "Something went wrong";
		});
	});

	$("use-local").addEventListener("click", function() {
		hideAuth();
		enterLocalMode();
	});
}

function logout() {
	api("/api/auth/logout", { method: "POST" }).finally(function() {
		mode = "local";
		store = LocalStore;
		renderAccount(null);
		showAuth();
	});
}

/* ---------------------------------------------------------------------------
   Mode entry
   --------------------------------------------------------------------------- */
function startWithSettings() {
	return store.loadSettings().then(function(s) {
		$("day-start").value = s.day_start || "06:00";
		applyDayStart($("day-start").value);
		goToDate(currentDate);
		refreshHistory();
	});
}

function enterRemoteMode(user) {
	mode = "remote";
	store = RemoteStore;
	renderAccount(user && user.username);
	startWithSettings();
}

function enterLocalMode() {
	mode = "local";
	store = LocalStore;
	renderAccount(null);
	startWithSettings();
}

/* ---------------------------------------------------------------------------
   PWA service worker
   --------------------------------------------------------------------------- */
function registerServiceWorker() {
	if ("serviceWorker" in navigator) {
		window.addEventListener("load", function() {
			navigator.serviceWorker.register("sw.js").catch(function() { /* ignore */ });
		});
	}
}

/* ---------------------------------------------------------------------------
   Init
   --------------------------------------------------------------------------- */
function init() {
	buildPalette();
	buildBlocks();
	setupPainting();
	setupDayStart();
	setupAuthForm();
	setActive(activeCategory);

	$("prev-day").addEventListener("click", function() { shiftDate(-1); });
	$("next-day").addEventListener("click", function() { shiftDate(1); });
	$("today-btn").addEventListener("click", function() { goToDate(todayStr()); });
	$("date-picker").addEventListener("change", function() {
		if (this.value) { goToDate(this.value); }
	});

	$("clear-day").addEventListener("click", function() {
		plan = {};
		renderPlan();
		updateSummary();
		persistPlan();
	});

	// Decide mode: ask the backend who we are.
	api("/api/me").then(function(user) {
		backendAvailable = true;
		enterRemoteMode(user);          // already signed in
	}).catch(function(err) {
		if (err && err.status === 401) {
			backendAvailable = true;     // backend is there, just signed out
			renderAccount(null);
			enterLocalMode();            // usable immediately...
			showAuth();                  // ...but offer to sign in
		} else {
			backendAvailable = false;    // no backend (e.g. opened as a file)
			enterLocalMode();
		}
	});

	tick();
	registerServiceWorker();
}

init();
