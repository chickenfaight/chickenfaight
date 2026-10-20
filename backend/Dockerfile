FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /usr/local/bin/uv

WORKDIR /app

# PYTHONUNBUFFERED=1 tells python to send output to stdout and stderr without holding it in buffer
# PYTHONDONTWRITEBYTECODE=1 tells python not to create .pyc files in __pycache__
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    APP_ENV=production

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app

RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
