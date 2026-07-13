import logging
from typing import Optional

from google import genai
from google.genai import types as genai_types
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import Document, DocumentChunk

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None


def get_genai_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


async def _embed(text: str, task_type: str) -> list[float]:
    result = await get_genai_client().aio.models.embed_content(
        model=settings.embedding_model,
        contents=text,
        config=genai_types.EmbedContentConfig(
            task_type=task_type,
            output_dimensionality=settings.embedding_dimensions,
        ),
    )
    return list(result.embeddings[0].values)


async def search_documents(query: str, db: AsyncSession, top_k: int = 5) -> str:
    try:
        embedding = await _embed(query, "RETRIEVAL_QUERY")
    except Exception as e:
        logger.error("Embedding failed: %s", e)
        return "Unable to search documents right now."

    distance_expr = DocumentChunk.embedding.cosine_distance(embedding).label("distance")

    result = await db.execute(
        select(DocumentChunk.content, Document.filename, distance_expr)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.status.like("ready%"))
        .order_by(distance_expr)
        .limit(top_k)
    )
    rows = result.all()

    if not rows:
        return "No relevant information found in the documents."

    best = rows[0].distance
    if best > settings.distance_threshold:
        return "No relevant information found in the documents."

    cutoff = min(settings.distance_threshold, best + settings.relative_margin)
    parts = [
        f"Source: {row.filename}\n{row.content}"
        for row in rows
        if row.distance <= cutoff
    ]
    return "\n---\n".join(parts) if parts else "No relevant information found in the documents."


async def list_documents(db: AsyncSession) -> str:
    result = await db.execute(
        select(Document.filename, Document.file_type, Document.status)
        .order_by(Document.uploaded_at.desc())
    )
    rows = result.all()
    if not rows:
        return "No documents are currently indexed."
    lines = [f"- {r.filename} ({r.file_type}, {r.status.split(':')[0]})" for r in rows]
    return "Indexed documents:\n" + "\n".join(lines)


async def embed_for_ingestion(text: str) -> list[float]:
    return await _embed(text, "RETRIEVAL_DOCUMENT")


async def embed_batch_for_ingestion(texts: list[str]) -> list[list[float]]:
    result = await get_genai_client().aio.models.embed_content(
        model=settings.embedding_model,
        contents=texts,
        config=genai_types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=settings.embedding_dimensions,
        ),
    )
    return [list(e.values) for e in result.embeddings]
