# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS admin-build
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin ./
ARG VITE_SHOPIFY_API_KEY
ENV VITE_SHOPIFY_API_KEY=$VITE_SHOPIFY_API_KEY
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.9.5 AS uv
FROM python:3.13-slim AS app-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY --from=admin-build /app/admin/dist ./admin/dist
COPY alembic.ini ./
COPY alembic ./alembic
RUN uv sync --frozen --no-dev --no-editable

FROM app-base AS debugger
RUN uv sync --frozen --all-groups
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app
USER app

EXPOSE 8000 5678
CMD ["uv", "run", "--frozen", "--no-sync", "python", "-Xfrozen_modules=off", "-m", "debugpy", "--listen", "0.0.0.0:5678", "--wait-for-client", "-m", "uvicorn", "shopify_app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM app-base AS production
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app
USER app

EXPOSE 8000
CMD ["uv", "run", "--frozen", "--no-sync", "uvicorn", "shopify_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
