"""Настройки проекта. Читаются из файла .env, который лежит рядом."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"


def _load_env_file() -> None:
    """Простой читатель .env: строки вида КЛЮЧ=значение."""
    if not ENV_PATH.exists():
        return
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file()


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw)
    except ValueError:
        return default


BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
ADMIN_ID = _int_env("ADMIN_ID", 0)
WEBAPP_URL = os.environ.get("WEBAPP_URL", "").strip().rstrip("/")
HOST = os.environ.get("HOST", "0.0.0.0").strip()
PORT = _int_env("PORT", 8080)

# Где лежит файл базы. На хостинге его кладут на постоянный диск,
# чтобы данные переживали перезапуск приложения.
DB_PATH = Path(os.environ.get("DB_PATH", "").strip() or BASE_DIR / "event.db")
WEB_DIR = BASE_DIR / "web"


def check() -> list[str]:
    """Возвращает список проблем в настройках. Пустой список - всё в порядке."""
    problems = []
    if not BOT_TOKEN:
        problems.append("В файле .env не заполнен BOT_TOKEN (токен от BotFather).")
    if not ADMIN_ID:
        problems.append("В файле .env не заполнен ADMIN_ID (ваш числовой Telegram ID).")
    if not WEBAPP_URL:
        problems.append("В файле .env не заполнен WEBAPP_URL (публичный адрес мини-приложения).")
    elif not WEBAPP_URL.startswith("https://"):
        problems.append("WEBAPP_URL должен начинаться с https:// - Telegram не открывает мини-приложения по http.")
    return problems
