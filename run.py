"""Запускает сервер и бота одной командой: python run.py"""

import asyncio
import logging

import uvicorn

import bot as bot_module
import config
import db
from server import app


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    problems = config.check()
    if problems:
        print("Не хватает настроек в файле .env:")
        for problem in problems:
            print("  -", problem)
        print("Заполните их и запустите снова.")
        return

    db.init()

    server = uvicorn.Server(
        uvicorn.Config(app, host=config.HOST, port=config.PORT, log_level="info")
    )
    bot = bot_module.make_bot()

    print(f"Мини-приложение будет доступно по адресу: {config.WEBAPP_URL}")
    try:
        await asyncio.gather(server.serve(), bot_module.run_bot(bot))
    finally:
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Остановлено.")
