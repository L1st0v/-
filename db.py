"""База данных SQLite. Один файл event.db рядом с проектом."""

import sqlite3
import threading
from datetime import datetime, timezone

import config

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def init() -> None:
    """Создаёт таблицы, если их ещё нет. Вызывать при запуске."""
    with _lock:
        conn = _connect()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                tg_id      INTEGER PRIMARY KEY,
                username   TEXT,
                first_name TEXT,
                last_name  TEXT,
                first_seen TEXT NOT NULL,
                last_seen  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO state (key, value) VALUES ('stage', '1')"
        )
        conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def remember_user(user: dict) -> None:
    """Записывает участника или обновляет время последнего входа."""
    now = _now()
    with _lock:
        conn = _connect()
        conn.execute(
            """
            INSERT INTO users (tg_id, username, first_name, last_name, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(tg_id) DO UPDATE SET
                username   = excluded.username,
                first_name = excluded.first_name,
                last_name  = excluded.last_name,
                last_seen  = excluded.last_seen
            """,
            (
                int(user["id"]),
                user.get("username"),
                user.get("first_name"),
                user.get("last_name"),
                now,
                now,
            ),
        )
        conn.commit()


def count_users() -> int:
    with _lock:
        row = _connect().execute("SELECT COUNT(*) AS n FROM users").fetchone()
        return int(row["n"])


def get_stage() -> int:
    with _lock:
        row = _connect().execute("SELECT value FROM state WHERE key = 'stage'").fetchone()
        return int(row["value"]) if row else 1


def set_stage(number: int) -> None:
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO state (key, value) VALUES ('stage', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(int(number)),),
        )
        conn.commit()


def user_order(tg_id: int) -> int:
    """Какой по счёту этот участник среди всех, кто уже заходил.

    Считаем от нуля по времени первого входа. Нужен, чтобы раздать
    участникам разные слова кодовой фразы.
    """
    with _lock:
        rows = _connect().execute(
            "SELECT tg_id FROM users ORDER BY first_seen, tg_id"
        ).fetchall()
    for position, row in enumerate(rows):
        if int(row["tg_id"]) == int(tg_id):
            return position
    return 0


def all_user_ids() -> list[int]:
    """Все, кто хоть раз писал боту или открывал приложение."""
    with _lock:
        rows = _connect().execute("SELECT tg_id FROM users ORDER BY tg_id").fetchall()
        return [int(row["tg_id"]) for row in rows]


def advance_stage(from_stage: int, to_stage: int) -> bool:
    """Переводит всех с одного этапа на другой.

    Возвращает True только тому, кто успел первым. Если двое участников
    напишут фразу одновременно, рассылка уйдёт один раз, а не два.
    """
    with _lock:
        conn = _connect()
        cursor = conn.execute(
            "UPDATE state SET value = ? WHERE key = 'stage' AND value = ?",
            (str(int(to_stage)), str(int(from_stage))),
        )
        conn.commit()
        return cursor.rowcount == 1
