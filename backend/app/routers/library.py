"""跨项目素材库：把项目里的角色/场景/道具存进来，以后在别的项目里一键导入。"""
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import schemas as S
from ..config import MEDIA_DIR
from ..db import get_db
from ..models import Character, LibraryItem, Project, Prop, Scene
from ..services import media
from .media import UPLOAD_EXTS, MAX_UPLOAD

router = APIRouter(prefix="/api", tags=["library"])

KINDS = {"character": Character, "scene": Scene, "prop": Prop}
KIND_NAMES = {"character": "角色", "scene": "场景", "prop": "道具"}


def _get(db: Session, model, obj_id: int):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(404, f"{model.__name__} {obj_id} 不存在")
    return obj


def _check_kind(kind: str):
    if kind not in KINDS:
        raise HTTPException(400, f"未知的素材类型：{kind}")


def _stamped(stem: str, suffix: str) -> str:
    return f"{stem}_{int(time.time() * 1000)}{suffix}"


def _copy_image(src_rel: str, dest_stem: str) -> str:
    """复制一份图片，返回新的相对路径；源文件不存在返回空串。"""
    if not src_rel or not (MEDIA_DIR / src_rel).is_file():
        return ""
    rel = _stamped(dest_stem, Path(src_rel).suffix.lower())
    (MEDIA_DIR / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(MEDIA_DIR / src_rel, MEDIA_DIR / rel)
    return rel


@router.get("/library", response_model=list[S.LibraryOut])
def list_library(kind: str | None = None, q: str = "", db: Session = Depends(get_db)):
    query = db.query(LibraryItem)
    if kind:
        query = query.filter(LibraryItem.kind == kind)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(LibraryItem.name.like(like), LibraryItem.description.like(like),
                                 LibraryItem.tags.like(like)))
    return query.order_by(LibraryItem.updated_at.desc()).all()


@router.post("/library", response_model=S.LibraryOut)
def create_library_item(body: S.LibraryIn, db: Session = Depends(get_db)):
    _check_kind(body.kind)
    item = LibraryItem(**body.model_dump())
    db.add(item)
    db.commit()
    return item


@router.patch("/library/{lid}", response_model=S.LibraryOut)
def update_library_item(lid: int, body: S.LibraryPatch, db: Session = Depends(get_db)):
    item = _get(db, LibraryItem, lid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    return item


@router.delete("/library/{lid}")
def delete_library_item(lid: int, db: Session = Depends(get_db)):
    item = _get(db, LibraryItem, lid)
    db.delete(item)
    db.commit()
    media.remove_file(item.image)
    return {"ok": True}


@router.post("/library/{lid}/upload", response_model=S.LibraryOut)
async def upload_library_image(lid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    item = _get(db, LibraryItem, lid)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in UPLOAD_EXTS:
        raise HTTPException(400, "只支持 PNG / JPG / WEBP 图片")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, "图片不能超过 20MB")
    rel = _stamped(f"library/{item.kind}{item.id}", suffix)
    (MEDIA_DIR / rel).parent.mkdir(parents=True, exist_ok=True)
    (MEDIA_DIR / rel).write_bytes(data)
    media.set_file(db, item, "image", rel)
    return item


@router.post("/library/save")
def save_to_library(body: S.SaveToLibrary, db: Session = Depends(get_db)):
    """把项目里的一个资产存进素材库；库里已有同类同名的就更新它。"""
    _check_kind(body.kind)
    asset = _get(db, KINDS[body.kind], body.id)
    description = asset.appearance if body.kind == "character" else asset.description
    item = (db.query(LibraryItem)
            .filter(LibraryItem.kind == body.kind, LibraryItem.name == asset.name).first())
    updated = item is not None
    if not item:
        item = LibraryItem(kind=body.kind, name=asset.name)
        db.add(item)
        db.flush()
    item.description = description
    item.image_prompt = asset.image_prompt
    item.voice = getattr(asset, "voice", "") or ""
    item.tags = item.tags or asset.project.name
    new_image = _copy_image(asset.ref_image, f"library/{body.kind}{item.id}")
    if new_image:
        media.set_file(db, item, "image", new_image)
    db.commit()
    verb = "已更新素材库里的" if updated else "已存入素材库："
    return {"item": S.LibraryOut.model_validate(item), "updated": updated,
            "message": f"{verb}{KIND_NAMES[body.kind]}「{item.name}」"}


@router.post("/projects/{pid}/library-import")
def import_from_library(pid: int, body: S.ImportFromLibrary, db: Session = Depends(get_db)):
    """把素材库里选中的条目复制进项目；项目里已有同名的跳过，不覆盖。"""
    p = _get(db, Project, pid)
    existing = {
        "character": {c.name for c in p.characters},
        "scene": {s.name for s in p.scenes},
        "prop": {x.name for x in p.props},
    }
    created, skipped = [], []
    for lid in body.ids:
        item = db.get(LibraryItem, lid)
        if not item or item.kind not in KINDS:
            continue
        if item.name in existing[item.kind]:
            skipped.append(item.name)
            continue
        if item.kind == "character":
            asset = Character(project_id=pid, name=item.name, appearance=item.description,
                              image_prompt=item.image_prompt, voice=item.voice)
        else:
            asset = KINDS[item.kind](project_id=pid, name=item.name, description=item.description,
                                     image_prompt=item.image_prompt)
        db.add(asset)
        db.flush()
        prefix = {"character": "char", "scene": "scene", "prop": "prop"}[item.kind]
        asset.ref_image = _copy_image(item.image, f"p{pid}/assets/{prefix}{asset.id}")
        existing[item.kind].add(item.name)
        created.append(item.name)
    db.commit()
    msg = f"导入了 {len(created)} 个" if created else "没有导入新的素材"
    if skipped:
        msg += f"；项目里已有同名的，已跳过：{'、'.join(skipped)}"
    return {"created": created, "skipped": skipped, "message": msg}
