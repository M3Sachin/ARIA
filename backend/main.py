import asyncio
import json
import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import authenticate_user, consume_ws_ticket, get_current_user, issue_ws_ticket, require_admin, seed_users
from config import settings
from database import Document, SessionMessage, VoiceSession, get_db, init_db, session_factory
from tools import list_documents, search_documents

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """You are ARIA — Adaptive Retrieval Intelligence Assistant. \
You are a voice assistant built to answer questions using a specific set of documents. \
Speak naturally and concisely, like a sharp, composed assistant — not like you are reading a report aloud.

IDENTITY:
- Your name is ARIA. Always introduce yourself as ARIA.
- If asked who you are, what model you are, what AI powers you, or anything about your identity or underlying technology, \
say only that you are ARIA, a voice intelligence assistant. Do not mention Gemini, Google, or any other model or company.
- You were created by Sachin to assist users through intelligent voice-based document retrieval.

RULES:
1. For any factual question about the documents, always call search_documents first — never answer from memory or assumption.
2. If the search results do not contain a clear answer, say so honestly: 'I don't see that in the documents' rather than guessing.
3. Briefly mention which document an answer came from, in natural language (e.g. 'according to the Q3 report') rather than reading filenames verbatim.
4. Keep spoken answers short. Offer to go deeper if the person wants more detail.
5. If asked what you can help with, explain you can answer questions about the currently indexed documents, and can list them if asked."""

FUNCTION_DECLARATIONS = [
    genai_types.FunctionDeclaration(
        name="search_documents",
        description="Search through indexed documents for information relevant to the user's question.",
        parameters=genai_types.Schema(
            type=genai_types.Type.OBJECT,
            properties={
                "query": genai_types.Schema(
                    type=genai_types.Type.STRING,
                    description="The search query derived from the user's question.",
                ),
                "top_k": genai_types.Schema(
                    type=genai_types.Type.INTEGER,
                    description="Number of document chunks to retrieve (default 5).",
                ),
            },
            required=["query"],
        ),
    ),
    genai_types.FunctionDeclaration(
        name="list_documents",
        description="List all currently indexed documents and their status.",
        parameters=genai_types.Schema(type=genai_types.Type.OBJECT, properties={}),
    ),
]

limiter = Limiter(key_func=get_remote_address)

_gemini_client: Optional[genai.Client] = None


def get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options={"api_version": settings.gemini_api_version},
        )
    return _gemini_client


def _build_live_config(conversation_history: list[dict] | None = None) -> genai_types.LiveConnectConfig:
    system_text = SYSTEM_INSTRUCTION
    if conversation_history:
        lines = "\n\nCONVERSATION HISTORY (for context — do not repeat it back):\n"
        for entry in conversation_history[-settings.history_context_turns:]:
            label = "User" if entry["role"] == "user" else "Assistant (you)"
            lines += f"{label}: {entry['text']}\n"
        system_text += lines + "\n(Continue naturally from where the conversation left off.)"

    return genai_types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=genai_types.SpeechConfig(
            voice_config=genai_types.VoiceConfig(
                prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(voice_name=settings.voice_name)
            )
        ),
        input_audio_transcription=genai_types.AudioTranscriptionConfig(),
        output_audio_transcription=genai_types.AudioTranscriptionConfig(),
        system_instruction=genai_types.Content(parts=[genai_types.Part(text=system_text)]),
        tools=[genai_types.Tool(function_declarations=FUNCTION_DECLARATIONS)],
    )


async def _startup() -> None:
    try:
        await init_db()
        async with session_factory() as db:
            await seed_users(db)
    except Exception as e:
        logger.error("Startup initialization failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_startup())
    yield


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_url_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class SessionMessageSchema(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=0, max_length=10_000)
    ts: int = Field(ge=0)


class SaveSessionRequest(BaseModel):
    messages: list[SessionMessageSchema] = Field(min_length=1, max_length=1_000)


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
@limiter.limit("5/minute")
async def api_login(request: Request, body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    result = await authenticate_user(body.username, body.password, db)
    if not result:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if isinstance(result, str) and result.startswith("locked:"):
        minutes = result.split(":")[1]
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=f"Account locked. Try again in {minutes} minute(s).")
    response.set_cookie(
        key=settings.cookie_name,
        value=result["token"],
        httponly=True,
        secure=settings.is_production,
        samesite="none" if settings.is_production else "lax",
        max_age=settings.jwt_expire_hours * 3600,
    )
    return {"username": result["username"], "role": result["role"]}


@app.post("/api/logout")
async def api_logout(response: Response):
    response.delete_cookie(key=settings.cookie_name, samesite="none", secure=True)
    return {"ok": True}


@app.get("/api/me")
async def api_me(user: dict = Depends(get_current_user)):
    return user


@app.get("/api/ws-ticket")
@limiter.limit("20/minute")
async def api_ws_ticket(request: Request, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ticket = await issue_ws_ticket(user["username"], user["role"], db)
    return {"ticket": ticket}


# ── Documents ─────────────────────────────────────────────────────────────────

@app.post("/api/upload")
@limiter.limit("20/hour")
async def api_upload(request: Request, file: UploadFile, _user: dict = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    contents = await file.read()
    original_name = file.filename or "upload"
    tmp_dir = tempfile.mkdtemp()
    actual_path = Path(tmp_dir) / original_name
    try:
        actual_path.write_bytes(contents)
        from ingest import ingest_file
        await ingest_file(actual_path, db)
    finally:
        actual_path.unlink(missing_ok=True)
        try:
            Path(tmp_dir).rmdir()
        except OSError:
            pass
    return {"ok": True, "filename": file.filename}


@app.get("/api/documents")
async def api_list_documents(_user: dict = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Document).order_by(Document.uploaded_at.desc()))
    docs = result.scalars().all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "file_type": d.file_type,
            "status": d.status.split(":")[0] if d.status else d.status,
            "uploaded_at": d.uploaded_at.isoformat(),
        }
        for d in docs
    ]


@app.delete("/api/documents/{doc_id}")
async def api_delete_document(doc_id: int, _user: dict = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await db.execute(sa_delete(Document).where(Document.id == doc_id))
    await db.commit()
    return {"ok": True}


# ── Transcript sessions ───────────────────────────────────────────────────────

@app.post("/api/sessions")
async def api_save_session(
    body: SaveSessionRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.messages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No messages to save")
    voice_session = VoiceSession(username=user["username"], message_count=len(body.messages))
    db.add(voice_session)
    await db.flush()
    db.add_all([
        SessionMessage(session_id=voice_session.id, role=m.role, text=m.text, ts=m.ts)
        for m in body.messages
    ])
    await db.commit()
    return {"id": voice_session.id}


@app.get("/api/sessions")
async def api_get_sessions(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VoiceSession)
        .where(VoiceSession.username == user["username"])
        .options(selectinload(VoiceSession.messages))
        .order_by(VoiceSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "created_at": s.created_at.isoformat(),
            "messages": [{"role": m.role, "text": m.text, "ts": m.ts} for m in s.messages],
        }
        for s in sessions
    ]


@app.delete("/api/sessions")
async def api_clear_sessions(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(sa_delete(VoiceSession).where(VoiceSession.username == user["username"]))
    await db.commit()
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
async def api_delete_session(
    session_id: int,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        sa_delete(VoiceSession).where(
            VoiceSession.id == session_id,
            VoiceSession.username == user["username"],
        )
    )
    await db.commit()
    return {"ok": True}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Voice WebSocket ───────────────────────────────────────────────────────────

@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket, ticket: str = Query(...)):
    async with session_factory() as db:
        user = await consume_ws_ticket(ticket, db)
    if not user:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    logger.info("Voice WS connected: %s", user["username"])

    gemini = get_gemini_client()
    audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
    browser_alive = True
    conversation_history: list[dict] = []
    _user_buf: list[str] = []
    _model_buf: list[str] = []

    async def send_json(data: dict) -> None:
        try:
            await websocket.send_text(json.dumps(data))
        except Exception:
            pass

    async def browser_reader() -> None:
        nonlocal browser_alive
        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if "bytes" in msg and msg["bytes"]:
                    await audio_queue.put(msg["bytes"])
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error("browser_reader: %s", e)
        finally:
            browser_alive = False
            await audio_queue.put(None)

    async def handle_response(response, gemini_session) -> None:
        nonlocal _user_buf, _model_buf

        if response.server_content:
            content = response.server_content

            if content.model_turn:
                for part in content.model_turn.parts:
                    if getattr(part, "inline_data", None) and part.inline_data.data:
                        await websocket.send_bytes(part.inline_data.data)

            if getattr(content, "input_transcription", None):
                chunk = getattr(content.input_transcription, "text", "") or ""
                if chunk.strip():
                    _user_buf.append(chunk.strip())

            if getattr(content, "output_transcription", None):
                chunk = getattr(content.output_transcription, "text", "") or ""
                if chunk.strip():
                    _model_buf.append(chunk.strip())

            if getattr(content, "turn_complete", False):
                if _user_buf:
                    full = " ".join(_user_buf)
                    await send_json({"type": "transcript", "role": "user", "text": full})
                    conversation_history.append({"role": "user", "text": full})
                    _user_buf.clear()
                if _model_buf:
                    full = " ".join(_model_buf)
                    await send_json({"type": "transcript", "role": "assistant", "text": full})
                    conversation_history.append({"role": "model", "text": full})
                    _model_buf.clear()
                if len(conversation_history) > settings.history_limit:
                    conversation_history[:] = conversation_history[-settings.history_limit:]
                await send_json({"type": "turn_complete"})
                await send_json({"type": "status", "state": "idle"})

        if response.tool_call:
            await send_json({"type": "status", "state": "thinking"})
            for fc in response.tool_call.function_calls:
                args = dict(fc.args)
                await send_json({"type": "tool_call", "name": fc.name, "args": args})
                async with session_factory() as db:
                    if fc.name == "search_documents":
                        tool_result = await search_documents(
                            query=args.get("query", ""),
                            db=db,
                            top_k=int(args.get("top_k", 5)),
                        )
                        if "Source:" in tool_result:
                            for line in tool_result.split("\n"):
                                if line.startswith("Source:"):
                                    await send_json({"type": "source_cited", "filename": line[len("Source:"):].strip()})
                    elif fc.name == "list_documents":
                        tool_result = await list_documents(db)
                    else:
                        tool_result = f"Unknown tool: {fc.name}"
                await gemini_session.send_tool_response(
                    function_responses=[
                        genai_types.FunctionResponse(name=fc.name, id=fc.id, response={"result": tool_result})
                    ]
                )
                await send_json({"type": "status", "state": "speaking"})

        if getattr(response, "setup_complete", None):
            await send_json({"type": "status", "state": "idle"})

    reader_task = asyncio.create_task(browser_reader())

    try:
        while browser_alive:
            try:
                config = _build_live_config(conversation_history or None)
                async with gemini.aio.live.connect(model=settings.live_model, config=config) as gemini_session:

                    async def audio_sender() -> None:
                        while browser_alive:
                            chunk = await audio_queue.get()
                            if chunk is None:
                                break
                            try:
                                await gemini_session.send_realtime_input(
                                    audio=genai_types.Blob(mime_type=settings.audio_mime_type, data=chunk)
                                )
                            except Exception:
                                await audio_queue.put(chunk)
                                break

                    sender_task = asyncio.create_task(audio_sender())
                    try:
                        async for response in gemini_session.receive():
                            await handle_response(response, gemini_session)
                    except Exception as e:
                        logger.warning("Gemini session ended (%s), restarting...", e)
                    finally:
                        sender_task.cancel()
                        try:
                            await sender_task
                        except asyncio.CancelledError:
                            pass

            except Exception as e:
                logger.error("Gemini connect error: %s", e)
                await send_json({"type": "status", "state": "idle"})

            if browser_alive:
                await asyncio.sleep(0.3)

    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        try:
            await reader_task
        except asyncio.CancelledError:
            pass

    logger.info("Voice WS disconnected: %s", user["username"])
