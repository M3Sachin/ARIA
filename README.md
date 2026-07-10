<div align="center">

```
   █████╗ ██████╗ ██╗ █████╗
  ██╔══██╗██╔══██╗██║██╔══██╗
  ███████║██████╔╝██║███████║
  ██╔══██║██╔══██╗██║██╔══██║
  ██║  ██║██║  ██║██║██║  ██║
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝
```

### Adaptive Retrieval Intelligence Assistant

*A real-time voice agent that answers questions from your documents*

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Gemini](https://img.shields.io/badge/Gemini_Live-API-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev)
[![pgvector](https://img.shields.io/badge/pgvector-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---

## What is ARIA?

ARIA lets you **talk to your documents**. Upload PDFs, Word files, or any text-based content — then have a natural voice conversation with an AI that retrieves exact answers from those documents in real time.

Built by **Sachin** using Google's Gemini Live API, FastAPI, Next.js, and pgvector for semantic search.

---

## Screenshots

| Login | Voice Agent |
|:---:|:---:|
| ![Login](docs/screenshots/login.png) | ![Agent](docs/screenshots/agent-standby.png) |

> **Add screenshots:** Save a screenshot of each page as `docs/screenshots/login.png` and `docs/screenshots/agent-standby.png`.

---

## Features

- **Real-time voice conversation** — speak naturally; ARIA responds with sub-second latency via Gemini Live API
- **RAG (Retrieval-Augmented Generation)** — every factual answer is grounded in your uploaded documents using pgvector cosine similarity search
- **Multi-format ingestion** — PDF, DOCX, PPTX, XLSX, Markdown, plain text via MarkItDown
- **Persistent conversation history** — session transcripts saved to DB; browse and delete individual sessions
- **Audio cues** — distinct sounds for login success, access denied, and account lockout
- **Security hardened**
  - Account lockout after 5 failed login attempts (configurable)
  - JWT httponly cookies — no token in localStorage
  - WebSocket one-time ticket auth — replay-proof
  - Rate limiting on all sensitive endpoints
- **Auto-logout** — configurable inactivity timeout (default 15 min) with 60-second warning banner
- **Responsive UI** — works on mobile, tablet, and desktop
- **Admin panel** — upload documents, view ingestion status, delete documents

---

## Architecture

```
Browser
  │
  ├── HTTP/REST  ──────►  FastAPI  ──►  PostgreSQL (users, documents, sessions)
  │                          │
  └── WebSocket (PCM audio)  │
         │                   ▼
         │          Gemini Live API  ◄──►  search_documents() tool
         │                                        │
         │                                  pgvector cosine
         │                                  similarity search
         ◄── PCM audio ──────────────────────────┘
              + transcript + source citations
```

### Key components

| Layer | File | Responsibility |
|---|---|---|
| Config | `backend/config.py` | All env vars via pydantic-settings. Single source of truth. |
| Database | `backend/database.py` | SQLAlchemy 2.0 async ORM. Models: Document, DocumentChunk, User, VoiceSession, SessionMessage, WsTicket. |
| Auth | `backend/auth.py` | JWT cookie auth + one-time WS ticket + account lockout |
| Voice WS | `backend/main.py` | 3 concurrent asyncio tasks: browser reader, audio sender, Gemini receive loop |
| RAG | `backend/tools.py` | gemini-embedding-001 + pgvector cosine search with distance threshold + relative margin filter |
| Ingestion | `backend/ingest.py` | MarkItDown + paragraph-aware chunking with overlap + embed + upsert |
| Audio capture | `frontend/lib/audioCapture.ts` | AudioWorkletNode at 16 kHz PCM16, zero-copy ArrayBuffer transfer |
| Audio playback | `frontend/lib/audioPlayback.ts` | AudioContext chain scheduling for gapless playback |

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | Use pyenv or system Python |
| Node.js | 18+ | LTS recommended |
| PostgreSQL | 15+ | Must have the **pgvector** extension |
| Google AI API key | — | [Get one here](https://aistudio.google.com/apikey) |

> **Neon DB (recommended for quick start):** Create a free serverless Postgres instance at [neon.tech](https://neon.tech). pgvector is pre-installed. Copy the connection string into `DATABASE_URL`.

---

## Local Setup

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/ARIA.git
cd ARIA
```

### 2. Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

Edit `backend/.env` and fill in the required values:

```env
DATABASE_URL=postgresql+asyncpg://user:password@host/dbname
GEMINI_API_KEY=your_gemini_api_key_here
JWT_SECRET=your_random_64_char_secret_here
ADMIN_PASSWORD=your_admin_password
USER_PASSWORD=your_user_password
```

> **Generate a secure JWT secret:**
> ```bash
> python -c "import secrets; print(secrets.token_hex(32))"
> ```

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

On first run, `init_db()` creates all tables and seeds the two default user accounts automatically.

### 3. Ingest Documents

With the backend running and venv active:

```bash
# Single file
python ingest.py ../docs/report.pdf

# Entire folder (recursive)
python ingest.py ../docs/
```

Supported formats: `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.md`, `.txt`, and more.

Re-running ingest is safe — unchanged files are skipped; modified files are re-embedded automatically.

### 4. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000
NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES=15
```

Start the dev server:

```bash
npm run dev
# Open http://localhost:3000
```

### 5. Login

| Role | Default username | Password |
|---|---|---|
| Admin | `admin` | value of `ADMIN_PASSWORD` in your `.env` |
| User | `user` | value of `USER_PASSWORD` in your `.env` |

The **admin** role can upload and delete documents. The **user** role can only use the voice agent.

### 6. Audio cues (optional)

Place MP3 files in `frontend/public/` with these exact names:

| File | Trigger |
|---|---|
| `access-granted.mp3` | Successful login |
| `access-denied.mp3` | Wrong credentials |
| `initiating-shutdown.mp3` | Account locked out |

---

## Environment Variables Reference

### Backend (`backend/.env`)

**Required** — server refuses to start without these:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (asyncpg driver) |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `JWT_SECRET` | Secret for signing JWT tokens (min 32 chars) |
| `ADMIN_PASSWORD` | Password for the admin account |
| `USER_PASSWORD` | Password for the user account |

**Optional** — have sensible defaults:

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | Admin username |
| `USER_USERNAME` | `user` | User username |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowed origin (no trailing slash) |
| `ENV` | `development` | Set to `production` for stricter checks + secure cookies |
| `PORT` | `8000` | Server port |
| `LIVE_MODEL` | `gemini-2.0-flash-live-001` | Gemini Live model ID |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | Embedding model ID |
| `VOICE_NAME` | `Aoede` | Gemini voice name |
| `MAX_LOGIN_ATTEMPTS` | `5` | Failed attempts before account lockout |
| `LOCKOUT_MINUTES` | `15` | Account lockout duration |
| `HISTORY_CONTEXT_TURNS` | `10` | Conversation turns injected into each Gemini session |

See `backend/.env.example` for the full list.

### Frontend (`frontend/.env.local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | ✅ | — | Backend HTTP URL (no trailing slash) |
| `NEXT_PUBLIC_BACKEND_WS_URL` | ✅ | — | Backend WebSocket URL |
| `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES` | | `15` | Auto-logout after N minutes of inactivity |

---

## Production Deployment

### Backend → Render / Railway

```bash
cd backend
docker build -t aria-backend .
docker run -p 8000:8000 --env-file .env aria-backend
```

Or push to GitHub and connect your repo to Render:
- **Root directory:** `backend`
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Set `ENV=production` in the environment dashboard

### Frontend → Vercel

```bash
cd frontend
vercel --prod
```

Set environment variables in the Vercel dashboard. Make sure `NEXT_PUBLIC_BACKEND_URL` points to your deployed backend.

> **CORS:** `FRONTEND_URL` in your backend env must exactly match your Vercel deployment URL — no trailing slash. Cross-origin cookies require HTTPS on both ends (`SameSite=None; Secure` is set automatically when `ENV=production`).

---

## Security Notes

- All secrets are env-only — never committed to git
- JWT stored in httponly cookie — not accessible to JavaScript
- WebSocket tickets are single-use and expire in 60 seconds
- Account lockout is DB-backed — survives restarts and IP rotation
- Rate limits: 10/min login · 20/min WS ticket · 20/hr uploads
- Production mode rejects placeholder secrets at startup

---

## Project Layout

```
├── backend/
│   ├── main.py          # FastAPI: auth, uploads, WebSocket → Gemini relay
│   ├── auth.py          # JWT + bcrypt, one-time WebSocket tickets, account lockout
│   ├── config.py        # pydantic-settings: all config from environment
│   ├── database.py      # SQLAlchemy async ORM models + engine
│   ├── tools.py         # search_documents(), list_documents() for Gemini tool-calling
│   ├── ingest.py        # CLI: file → Markdown → chunks → embeddings → Postgres
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── login/       # Login page with audio cues
│   │   ├── admin/       # Document upload + management (admin only)
│   │   └── agent/       # Voice interface
│   ├── components/      # VoiceOrb, Waveform, TranscriptModal, SourcesPanel, UploadDock
│   ├── lib/             # audioCapture, audioPlayback, api client, useInactivityLogout
│   ├── public/
│   │   ├── worklets/pcm-processor.js
│   │   ├── access-granted.mp3       # optional audio cues
│   │   ├── access-denied.mp3
│   │   └── initiating-shutdown.mp3
│   └── .env.local.example
├── docs/
│   └── screenshots/     # Add login.png and agent-standby.png here
└── README.md
```

---

## Tech Stack

| | Technology |
|---|---|
| **LLM** | Google Gemini 2.0 Flash Live |
| **Embeddings** | Google Gemini Embedding 001 |
| **Vector DB** | PostgreSQL + pgvector |
| **Backend** | FastAPI · SQLAlchemy 2.0 async · pydantic-settings |
| **Frontend** | Next.js 15 · React 18 · TypeScript |
| **Audio** | Web Audio API · AudioWorkletNode |
| **Auth** | JWT httponly cookie · bcrypt · account lockout |

---

## License

MIT © Sachin
