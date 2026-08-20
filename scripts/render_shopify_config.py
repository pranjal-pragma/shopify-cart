from __future__ import annotations

import json
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

from shopify_app.config import get_settings

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = ROOT / "shopify.app.template.toml"
OUTPUT_PATH = ROOT / "shopify.app.toml"


def validate_app_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("APP_SHOPIFY_APP_URL must be an absolute HTTPS URL")
    if parsed.query or parsed.fragment:
        raise ValueError("APP_SHOPIFY_APP_URL cannot contain a query string or fragment")
    return value.rstrip("/")


def main() -> None:
    settings = get_settings()
    client_id = settings.shopify_client_id.strip()
    if not client_id or client_id in {"replace-me", "replace-with-dev-dashboard-client-id"}:
        raise ValueError("APP_SHOPIFY_CLIENT_ID must be configured in .env")

    app_name = settings.shopify_app_name.strip()
    if not app_name:
        raise ValueError("APP_SHOPIFY_APP_NAME must be configured in .env")
    if "shopify" in app_name.casefold():
        raise ValueError('APP_SHOPIFY_APP_NAME cannot contain the reserved word "Shopify"')

    app_url = validate_app_url(settings.shopify_app_url.strip())
    rendered = TEMPLATE_PATH.read_text(encoding="utf-8")
    rendered = rendered.replace("__SHOPIFY_CLIENT_ID__", json.dumps(client_id))
    rendered = rendered.replace("__SHOPIFY_APP_NAME__", json.dumps(app_name))
    rendered = rendered.replace("__SHOPIFY_APP_URL__", json.dumps(app_url))

    tomllib.loads(rendered)
    temporary_path = OUTPUT_PATH.with_suffix(".toml.tmp")
    temporary_path.write_text(rendered, encoding="utf-8")
    temporary_path.replace(OUTPUT_PATH)
    print(f"Generated {OUTPUT_PATH.name} from .env")


if __name__ == "__main__":
    main()
