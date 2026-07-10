# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in DATABASE_URL, GEMINI_API_KEY, JWT_SECRET, ADMIN_PASSWORD, USER_PASSWORD
uvicorn main:app --reload --port 8000
```

Always use `.venv/bin/pip` and `.venv/bin/python` — system Python will not have the packages.

Ingest documents (run from `backend/` with venv active):

```bash
python ingest.py ../docs/report.pdf      # single file
python ingest.py ../docs/               # entire folder
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local        # set NEXT_PUBLIC_BACKEND_URL and NEXT_PUBLIC_BACKEND_WS_URL
npm run dev                             # http://localhost:3000
npm run build && npm run lint
```

---

## Architecture

### Config

All runtime config lives in `backend/config.py` as a single `Settings(BaseSettings)` class. Every value is read from env via pydantic-settings — no `os.environ.get()` calls anywhere else. Required fields (`database_url`, `gemini_api_key`, `jwt_secret`, `admin_password`, `user_password`) have no defaults; process fails at startup if missing. Optional fields have sensible defaults. A `model_validator` rejects placeholder secrets when `ENV=production`.

### Database

`backend/database.py` owns the SQLAlchemy 2.0 async engine, all ORM models, and `init_db()`. Models: `Document`, `DocumentChunk` (with pgvector `Vector` column), `User`, `WsTicket`, `VoiceSession`, `SessionMessage`. `get_db()` is the FastAPI `Depends` generator. `session_factory` is used directly in the WebSocket handler (can't use `Depends` there) and in `ingest.py`.

### Auth flow

`backend/auth.py`. HTTP routes use JWT in an httponly cookie. WebSocket uses a one-time ticket pattern: client calls `GET /api/ws-ticket` (authenticated via cookie) to get a short-lived token, then passes it as `?ticket=` query param on the WebSocket upgrade. Ticket is consumed atomically via `UPDATE ... RETURNING` — replay impossible.

### Voice WebSocket

`backend/main.py` — `voice_websocket()`. Three concurrent asyncio tasks:

1. `browser_reader` — drains browser WebSocket frames into `asyncio.Queue`, sets `browser_alive = False` on disconnect.
2. `audio_sender` — reads from queue, forwards binary chunks to Gemini Live session immediately.
3. Main loop (`async for response in gemini_session.receive()`) — streams Gemini responses back to browser.

Outer `while browser_alive` loop reopens a fresh Gemini session after each turn ends (Gemini Live closes after every turn). Conversation history is preserved in `conversation_history: list[dict]` and baked into the system instruction via `_build_live_config(conversation_history)` on each reconnect — the Live API has no inject-history call.

### RAG search

`backend/tools.py`. `search_documents()` embeds the query with `gemini-embedding-001` (task type `RETRIEVAL_QUERY`), runs pgvector cosine distance against `document_chunks`, applies a two-layer filter (`DISTANCE_THRESHOLD` + `RELATIVE_MARGIN` relative to best match). `list_documents()` queries `documents` table directly.

### Ingestion

`backend/ingest.py`. CLI and upload-endpoint share `ingest_file(path, db)`. Pipeline: read bytes → SHA-256 → MarkItDown conversion → `_chunk_text()` (paragraph-aware, overlap) → embed each chunk → insert `DocumentChunk` rows. Re-ingestion skips unchanged files (hash match), re-embeds modified ones.

### Frontend audio pipeline

- `AudioCapture` (`lib/audioCapture.ts`) — `AudioWorkletNode` runs `pcm-processor.js` in the audio thread (not main thread). Downsamples to 16 kHz PCM16, zero-copy transfers each chunk to main thread via transferable `ArrayBuffer`, sends as binary WebSocket frame.
- `AudioPlayback` (`lib/audioPlayback.ts`) — schedules each incoming PCM16 chunk onto `AudioBufferSourceNode` chain using `AudioContext.currentTime` for gapless sample-accurate playback.

### Rate limiting

`slowapi` limiter wired in `main.py`. Login: 10/min. WS ticket: 20/min. Upload: 20/hr. Add `@limiter.limit(...)` + `request: Request` param to any new sensitive endpoint.

---

## Key constraints

- Gemini Live API closes after every turn — reconnect loop is intentional, not a bug.
- `COPY . .` in the Dockerfile copies the whole `backend/` dir; `.dockerignore` excludes `.env`, `.venv`, `__pycache__`.
- Cross-origin cookies require `SameSite=None; Secure` (set when `ENV=production`). CORS `allow_origins` must exactly match `FRONTEND_URL` — no trailing slash.
- `init_db()` is idempotent (`CREATE ... IF NOT EXISTS`). Safe to call on every startup.
