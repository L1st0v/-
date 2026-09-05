"""Проверка подписи initData.

Когда Telegram открывает мини-приложение, он передаёт странице строку initData:
кто зашёл, когда и подпись. Подпись сделана секретным ключом, который знают
только Telegram и владелец бота. Мы пересчитываем подпись у себя на сервере
и сравниваем. Если совпало - данные настоящие, подделать их нельзя.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

# Сколько секунд считаем initData свежей. Сутки - с запасом на долгое мероприятие.
MAX_AGE_SECONDS = 24 * 60 * 60


class InitDataError(Exception):
    """Данные не прошли проверку."""


def parse_init_data(init_data: str, bot_token: str) -> dict:
    """Проверяет подпись и возвращает разобранные данные вместе с полем user."""
    if not init_data:
        raise InitDataError("Пустые данные Telegram.")
    if not bot_token:
        raise InitDataError("На сервере не настроен токен бота.")

    fields = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = fields.pop("hash", "")
    if not received_hash:
        raise InitDataError("В данных Telegram нет подписи.")

    data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise InitDataError("Подпись не совпала.")

    try:
        auth_date = int(fields.get("auth_date", "0"))
    except ValueError:
        auth_date = 0
    if auth_date <= 0 or time.time() - auth_date > MAX_AGE_SECONDS:
        raise InitDataError("Данные Telegram устарели, откройте приложение заново.")

    raw_user = fields.get("user")
    if not raw_user:
        raise InitDataError("В данных Telegram нет сведений о пользователе.")
    try:
        user = json.loads(raw_user)
    except json.JSONDecodeError:
        raise InitDataError("Не удалось прочитать сведения о пользователе.")

    fields["user"] = user
    return fields


def display_name(user: dict) -> str:
    parts = [user.get("first_name") or "", user.get("last_name") or ""]
    name = " ".join(p for p in parts if p).strip()
    return name or (user.get("username") or "участник")
