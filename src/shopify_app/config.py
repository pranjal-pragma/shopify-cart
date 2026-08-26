from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="APP_",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Shopify FastAPI App"
    env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    database_url: str = "postgresql+asyncpg://shopify:shopify@localhost:5433/shopify_app"
    shopify_app_name: str = "pragma-site-cart"
    shopify_app_url: str = "https://app.example.com"
    shopify_client_id: str = "replace-me"
    shopify_client_secret: SecretStr = SecretStr("replace-me")
    token_encryption_key: SecretStr = SecretStr("replace-me")
    token_encryption_previous_keys: list[SecretStr] = Field(default_factory=list)
    shopify_api_version: str = "2026-07"
    http_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    webhook_max_body_bytes: int = Field(default=1_048_576, ge=1_024, le=10_485_760)

    @field_validator("shopify_api_version")
    @classmethod
    def validate_api_version(cls, value: str) -> str:
        year, separator, quarter = value.partition("-")
        if not (separator and year.isdigit() and quarter in {"01", "04", "07", "10"}):
            raise ValueError("must use Shopify's YYYY-(01|04|07|10) format")
        return value

    @model_validator(mode="after")
    def validate_production_safety(self) -> Settings:
        if self.env != "production":
            return self
        if self.debug:
            raise ValueError("debug must be disabled in production")
        if "*" in self.allowed_hosts or not self.allowed_hosts:
            raise ValueError("production allowed_hosts must be explicit")
        for name, value in (
            ("shopify_client_id", self.shopify_client_id),
            ("shopify_client_secret", self.shopify_client_secret.get_secret_value()),
            ("token_encryption_key", self.token_encryption_key.get_secret_value()),
        ):
            if value == "replace-me":
                raise ValueError(f"{name} must be configured in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
