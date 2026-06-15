# 100 blocks a day

A tool to visually structure your day — one of ~100 ten-minute blocks at a time —
for more happiness and productivity.

Inspired by [100 blocks a day](https://waitbutwhy.com/2016/10/100-blocks-day.html):
100 is a good number, and so is 😴. Instead of printing it out, this is a webtool
(installable as a PWA) so you can plan your day on any device, as often as you like.

## Features

- **100-block grid** — pick a category (Sleep, Work, Health, Eat, Social, Leisure,
  Chores) then **click or drag** to paint blocks. Works with mouse and touch.
- **"Now" highlight** — the block matching the current time pulses, based on a
  **settable day-start time** (100 blocks × 10 min ≈ a 16h40m waking day).
- **History** — every day you plan is saved and revisitable; jump between dates.
- **Multi-user sync** — sign in and your plans + settings follow you across devices
  (great for family use).
- **PWA** — installable on phone and desktop, with an offline app shell.
- **Local fallback** — with no backend (e.g. opening the file directly), it runs in
  local-only mode using `localStorage`, exactly like the original.

## Layout

```
static/            The frontend (vanilla JS, no build step, no dependencies)
  index.html       markup
  styles.css       styles
  app.js           app logic + storage layer (remote API or localStorage)
  sw.js            service worker (offline app shell)
  manifest.webmanifest
  icons/
backend/           FastAPI + SQLite backend
  app/
    main.py        API routes + serves the frontend
    models.py      User, DayPlan (one row per user per date)
    auth.py        bcrypt password hashing + cookie JWT sessions
    schemas.py, database.py, config.py
  requirements.txt
```

## Running locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then open <http://127.0.0.1:8000>. The FastAPI app serves both the API (under
`/api`) and the frontend, so there's no CORS to deal with. A SQLite file
(`backend/blocks.db`) is created automatically on first run.

> Note: service workers and the "install to home screen" prompt require
> `http://localhost` or HTTPS — they won't activate when opening the file
> directly via `file://` (the app still works in local mode there).

## Configuration (environment variables)

| Variable                  | Default                | Purpose                                              |
| ------------------------- | ---------------------- | ---------------------------------------------------- |
| `BLOCKS_SECRET_KEY`       | *(insecure dev key)*   | **Set in production.** Signs auth tokens.            |
| `BLOCKS_DATABASE_URL`     | `sqlite:///blocks.db`  | SQLAlchemy DB URL.                                   |
| `BLOCKS_COOKIE_SECURE`    | `false`                | Set `true` behind HTTPS so cookies are HTTPS-only.   |
| `BLOCKS_ALLOW_REGISTRATION` | `true`               | Set `false` to disable open sign-ups once set up.    |
| `BLOCKS_TOKEN_TTL_HOURS`  | `720` (30 days)        | How long a login stays valid.                        |
| `BLOCKS_STATIC_DIR`       | `../static`            | Where the frontend lives.                            |

Generate a strong secret with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

## Deployment (VPS)

Run `uvicorn` behind your existing reverse proxy (nginx/Caddy) with HTTPS, set
`BLOCKS_SECRET_KEY` and `BLOCKS_COOKIE_SECURE=true`, and point a domain at it.
Once your family accounts exist you can set `BLOCKS_ALLOW_REGISTRATION=false`.
(We'll wire this into your server setup in a follow-up session.)
