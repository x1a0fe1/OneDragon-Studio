"""OneDragon Studio 后端入口。

开发：  uvicorn app.main:app --port 8100 --reload --reload-dir app
"""
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import models  # noqa: F401  注册表结构
from .config import MEDIA_DIR
from .db import Base, add_missing_columns, engine
from .routers import library, media, projects, system
from .services import tasks

# Windows 会从注册表读 MIME 类型，有的机器把 .js 注册成 text/plain，浏览器会拒绝执行脚本
for _ext, _type in {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                    ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webp": "image/webp"}.items():
    mimetypes.add_type(_type, _ext)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    added = add_missing_columns()
    if added:
        logging.getLogger("onedragon").info("数据库已升级，新增列：%s", "、".join(added))
    tasks.start_worker()
    yield
    tasks.stop_worker()


app = FastAPI(title="OneDragon Studio", version="0.4.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5174", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(system.router)
app.include_router(projects.router)
app.include_router(media.router)
app.include_router(library.router)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

# 前端打包后（npm run build）由后端直接托管，只开一个端口即可使用
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith(("api/", "media/")):
            raise HTTPException(404)
        f = FRONTEND_DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
