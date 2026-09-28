from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/self_heal"
    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    cors_origins: str = "http://localhost:5173"

    # security
    max_upload_mb: float = 2.0      # ticket attachments / normal uploads
    knowledge_base_max_upload_mb: float = 50.0
    enable_hsts: bool = True        # only meaningful behind TLS (Nginx)

    # Ask More: fine-tuned T5 (state dict for t5-small); relative to backend/
    t5_enabled: bool = True
    t5_model_path: str = "models/t5-ask-more.pt"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
