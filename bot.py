"""Бот: кнопка входа, проверка кодовой фразы и рассылка при смене этапа."""

import asyncio
import logging
import socket

from aiogram import Bot, Dispatcher, F
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramNetworkError
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)

import config
import content
import db

log = logging.getLogger(__name__)

dp = Dispatcher()


def open_app_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть мини-приложение",
                    web_app=WebAppInfo(url=config.WEBAPP_URL),
                )
            ]
        ]
    )


def remember(message: Message) -> None:
    user = message.from_user
    if user is None or user.is_bot:
        return
    db.remember_user(
        {
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
        }
    )


SEND_TRIES = 3          # сколько раз пробуем достучаться до одного участника
SEND_RETRY_PAUSE = 1.5  # пауза между попытками, секунды


async def send_with_retry(bot: Bot, tg_id: int, text: str) -> bool:
    """Отправляет сообщение, переживая короткие обрывы связи."""
    for attempt in range(1, SEND_TRIES + 1):
        try:
            await bot.send_message(tg_id, text, reply_markup=open_app_keyboard())
            return True
        except TelegramNetworkError as error:
            log.warning("Связь оборвалась на %s (попытка %s): %s", tg_id, attempt, error)
            if attempt < SEND_TRIES:
                await asyncio.sleep(SEND_RETRY_PAUSE)
        except Exception as error:
            # Участник заблокировал бота или удалил чат - повторы не помогут.
            log.warning("Не удалось написать %s: %s", tg_id, error)
            return False
    return False


async def broadcast(bot: Bot, text: str) -> tuple[int, int]:
    """Рассылает текст всем участникам. Возвращает: доставлено, не доставлено."""
    delivered = 0
    failed = 0
    for tg_id in db.all_user_ids():
        if await send_with_retry(bot, tg_id, text):
            delivered += 1
        else:
            failed += 1
        # Пауза, чтобы Telegram не начал придерживать сообщения.
        await asyncio.sleep(0.05)
    return delivered, failed


@dp.message(CommandStart())
async def on_start(message: Message) -> None:
    remember(message)
    if not config.WEBAPP_URL.startswith("https://"):
        await message.answer(
            "Мини-приложение пока не настроено: в файле .env нет адреса WEBAPP_URL."
        )
        return
    await message.answer(
        "Привет! Нажмите кнопку, чтобы открыть мини-приложение мероприятия.",
        reply_markup=open_app_keyboard(),
    )


@dp.message(Command("stage"))
async def on_stage(message: Message) -> None:
    """Только для администратора: переключить этап вручную."""
    if message.from_user is None or message.from_user.id != config.ADMIN_ID:
        return
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].lstrip("-").isdigit():
        await message.answer("Напишите так: /stage 2")
        return
    number = int(parts[1])
    db.set_stage(number)
    await message.answer(f"Этап переключён на {number}. Рассылку не делаю.")


@dp.message(Command("status"))
async def on_status(message: Message) -> None:
    """Только для администратора: что происходит сейчас."""
    if message.from_user is None or message.from_user.id != config.ADMIN_ID:
        return
    await message.answer(
        f"Текущий этап: {db.get_stage()}\nУчастников в базе: {db.count_users()}"
    )


@dp.message(F.text)
async def on_text(message: Message) -> None:
    """Любое обычное сообщение проверяем как кодовую фразу."""
    remember(message)
    current = db.get_stage()

    if not content.phrase_matches(current, message.text or ""):
        await message.answer("Это не код для перехода на следующий этап")
        return

    next_stage = current + 1
    if not db.advance_stage(current, next_stage):
        # Кто-то другой успел на доли секунды раньше, рассылка уже ушла.
        return

    log.info("Этап %s пройден, переходим на %s", current, next_stage)
    delivered, failed = await broadcast(message.bot, content.announcement(next_stage))
    log.info("Рассылка: доставлено %s, не доставлено %s", delivered, failed)


class IPv4Session(AiohttpSession):
    """Соединение с Telegram только по IPv4.

    У части провайдеров IPv6 объявлен, но не работает. Тогда обычная
    попытка связаться с Telegram зависает и бот падает при запуске.
    """

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._connector_init["family"] = socket.AF_INET


def make_bot() -> Bot:
    return Bot(token=config.BOT_TOKEN, session=IPv4Session())


async def run_bot(bot: Bot) -> None:
    """Держит бота на связи. Обрыв интернета не роняет программу."""
    while True:
        try:
            await bot.delete_webhook(drop_pending_updates=True)
            await dp.start_polling(bot)
            return
        except TelegramNetworkError as error:
            log.warning("Нет связи с Telegram (%s). Повтор через 5 секунд.", error)
            await asyncio.sleep(5)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    db.init()
    bot = make_bot()
    try:
        await run_bot(bot)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
