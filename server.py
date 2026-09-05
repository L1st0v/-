"""Веб-сервер: отдаёт страницу мини-приложения и отвечает на её запросы."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
import content
import db
from auth import InitDataError, display_name, parse_init_data

NO_CACHE = {"Cache-Control": "no-store"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(title="Мини-приложение мероприятия", lifespan=lifespan)


@app.middleware("http")
async def no_cache(request, call_next):
    """Запрещаем браузерам запоминать страницу и её файлы.

    Иначе телефон участника может показать старую версию приложения
    после того, как мы что-то поправили.
    """
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response

app.mount("/static", StaticFiles(directory=config.WEB_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(config.WEB_DIR / "index.html", headers=NO_CACHE)


@app.post("/api/state")
def api_state(x_init_data: str = Header(default="", alias="X-Init-Data")):
    """Кто зашёл и что показывать прямо сейчас.

    Страница спрашивает это при открытии и потом раз в несколько секунд,
    чтобы этап переключился у всех сам, без перезагрузки.
    """
    try:
        data = parse_init_data(x_init_data, config.BOT_TOKEN)
    except InitDataError as error:
        raise HTTPException(status_code=401, detail=str(error))

    user = data["user"]
    db.remember_user(user)
    stage_number = db.get_stage()
    return {
        "id": user["id"],
        "name": display_name(user),
        "is_admin": int(user["id"]) == config.ADMIN_ID,
        "stage": content.public_view(stage_number),
        # Слово кодовой фразы, которое участник увидит, когда пройдёт игру.
        # У каждого своё, поэтому фразу придётся собирать всем набором.
        "word": content.personal_word(stage_number, db.user_order(user["id"])),
    }
