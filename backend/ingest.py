#!/usr/bin/env python3
"""
Document ingestion pipeline. Run as a CLI to bulk-load files:

    python ingest.py path/to/file.pdf
    python ingest.py path/to/folder/
"""
import asyncio
import hashlib
import logging
import os
import re
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from config import settings  # noqa: E402
from database import Document, DocumentChunk, init_db, session_factory  # noqa: E402
from tools import embed_batch_for_ingestion  # noqa: E402

from markitdown import MarkItDown
from sqlalchemy import delete as sa_delete, insert as sa_insert, select
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_type(path: Path) -> str:
    return path.suffix.lstrip(".").lower() or "unknown"


def _chunk_text(text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n(?=#{1,6} |\n)", text) if p.strip()]
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 <= settings.chunk_max_chars:
            current = (current + "\n\n" + para).strip() if current else para
        else:
            if current:
                chunks.append(current)
                overlap = current[-settings.chunk_overlap_chars:]
                current = (overlap + "\n\n" + para).strip()
            else:
                step = settings.chunk_max_chars - settings.chunk_overlap_chars
                for i in range(0, len(para), step):
                    chunks.append(para[i : i + settings.chunk_max_chars])
                current = para[-settings.chunk_overlap_chars:]

    if current:
        chunks.append(current)

    return [c for c in chunks if len(c) > 20]


async def ingest_file(path: Path, db: AsyncSession) -> None:
    logger.info("Processing: %s", path.name)
    raw = path.read_bytes()
    content_hash = _sha256(raw)

    existing = await db.scalar(select(Document).where(Document.filename == path.name))

    if existing:
        if existing.status == f"ready:{content_hash}":
            logger.info("Skipped (unchanged): %s", path.name)
            return
        logger.info("Re-ingesting (changed): %s", path.name)
        await db.execute(sa_delete(DocumentChunk).where(DocumentChunk.document_id == existing.id))
        existing.status = "processing"
        existing.file_type = _file_type(path)
        doc = existing
    else:
        doc = Document(filename=path.name, file_type=_file_type(path), status="processing")
        db.add(doc)

    await db.flush()

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=path.suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        loop = asyncio.get_running_loop()
        text_content = await loop.run_in_executor(
            None, lambda: MarkItDown().convert(tmp_path).text_content
        )
    except Exception as e:
        logger.error("Conversion failed for %s: %s", path.name, e)
        doc.status = "error"
        await db.commit()
        return
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    if not text_content or not text_content.strip():
        logger.warning("No text extracted from %s", path.name)
        doc.status = "empty"
        await db.commit()
        return

    text_content = text_content.replace("\x00", "")

    chunks = _chunk_text(text_content)
    logger.info("%d chunks from %s", len(chunks), path.name)

    # Gemini batch embedding: up to 100 texts per API call
    BATCH = 100
    rows: list[dict] = []
    for batch_start in range(0, len(chunks), BATCH):
        batch = chunks[batch_start : batch_start + BATCH]
        try:
            embeddings = await embed_batch_for_ingestion(batch)
        except Exception as e:
            logger.error("Batch embedding failed at chunk %d: %s", batch_start, e)
            continue
        for i, embedding in enumerate(embeddings):
            rows.append({
                "document_id": doc.id,
                "chunk_index": batch_start + i,
                "content": batch[i],
                "embedding": embedding,
            })
        logger.info("Embedded %d/%d chunks", min(batch_start + BATCH, len(chunks)), len(chunks))

    if not rows or len(rows) < len(chunks) // 2:
        logger.error(
            "Embedding incomplete for %s: %d/%d chunks — marking error",
            path.name, len(rows), len(chunks),
        )
        doc.status = "error"
        await db.commit()
        return

    await db.execute(sa_insert(DocumentChunk), rows)
    doc.status = f"ready:{content_hash}"
    await db.commit()
    logger.info("Done: %s (%d/%d chunks)", path.name, len(rows), len(chunks))


async def main(targets: list[str]) -> None:
    await init_db()
    paths: list[Path] = []
    for t in targets:
        p = Path(t)
        if p.is_dir():
            paths.extend(f for f in p.rglob("*") if f.is_file())
        elif p.is_file():
            paths.append(p)
        else:
            logger.warning("Not found: %s", t)

    if not paths:
        logger.error("No files to process.")
        return

    ok = failed = 0
    for path in paths:
        try:
            async with session_factory() as db:
                await ingest_file(path, db)
            ok += 1
        except Exception as e:
            logger.error("Error on %s: %s", path, e)
            failed += 1

    logger.info("Summary: %d succeeded, %d failed", ok, failed)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ingest.py <file_or_folder> [...]")
        sys.exit(1)
    asyncio.run(main(sys.argv[1:]))
