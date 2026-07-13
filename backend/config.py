from functools import lru_cache
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_PLACEHOLDER_SECRETS = {"change-me", "change-this-to-a-long-random-string", "secret", ""}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Required — no defaults; process fails at startup if missing
    database_url: str
    gemini_api_key: str
    jwt_secret: str
    admin_password: str
    user_password: str

    # Optional with sensible defaults
    frontend_url: str = "http://localhost:3000"
    admin_username: str = "admin"
    user_username: str = "user"
    cookie_name: str = "voice_rag_session"
    env: str = "development"

    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 12
    ticket_expire_seconds: int = 60

    # Gemini Live (voice)
    live_model: str = "gemini-3.1-flash-live-preview"
    gemini_api_version: str = "v1beta"
    voice_name: str = "Aoede"
    audio_mime_type: str = "audio/pcm;rate=16000"

    # Gemini Embeddings
    embedding_model: str = "models/gemini-embedding-001"
    embedding_dimensions: int = 768

    # RAG / retrieval
    chunk_max_chars: int = 2400
    chunk_overlap_chars: int = 400
    distance_threshold: float = 0.55
    relative_margin: float = 0.12

    # Conversation history
    history_limit: int = 20          # max turns kept in memory
    history_context_turns: int = 12  # turns injected into system instruction on reconnect

    # Database connection pool
    db_pool_size: int = 5
    db_max_overflow: int = 10

    # Auth
    ws_ticket_token_bytes: int = 32
    max_login_attempts: int = 5
    lockout_minutes: int = 15

    # Memsy memory (optional — leave blank to disable)
    memsy_api_key: str = ""
    memsy_base_url: str = "https://api.memsy.io/v1"
    memsy_memory_score_threshold: float = 0.7
    memsy_memory_limit: int = 5

    @model_validator(mode="after")
    def enforce_production_secrets(self) -> "Settings":
        if self.env.lower() != "production":
            return self
        for field in ("jwt_secret", "admin_password", "user_password"):
            if getattr(self, field).lower() in _PLACEHOLDER_SECRETS:
                raise ValueError(
                    f"{field} must not be a placeholder value when ENV=production"
                )
        return self

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    @property
    def frontend_url_list(self) -> list[str]:
        return [u.strip() for u in self.frontend_url.split(",")]

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        parsed = urlparse(url)
        params = {k: v[0] for k, v in parse_qs(parsed.query, keep_blank_values=True).items()
                  if k not in ("sslmode", "channel_binding")}
        return urlunparse(parsed._replace(query=urlencode(params)))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
