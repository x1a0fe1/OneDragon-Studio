"""生图、生视频、配音、合成、上传图片。生成类接口都只是把任务放进队列，马上返回。"""
from pathlib import Path

import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import schemas as S
from .. import settings_store
from ..config import MEDIA_DIR
from ..db import get_db
from ..i18n import _
from ..models import Character, Episode, Project, Prop, Scene, Shot
from ..providers import tts
from ..services import audio, media, tasks

router = APIRouter(prefix="/api", tags=["media"])

UPLOAD_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_UPLOAD = 20 * 1024 * 1024


def _get(db: Session, model, obj_id: int):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(404, _(f"{model.__name__} {obj_id} 不存在", f"{model.__name__} {obj_id} not found"))
    return obj


def _enqueue(db: Session, kind: str, target_id: int, project_id: int) -> S.TaskOut:
    return tasks.task_out(tasks.enqueue(db, kind, target_id, project_id))


# ---------- 单个生成 ----------
@router.post("/characters/{cid}/image", response_model=S.TaskOut)
def gen_character_image(cid: int, db: Session = Depends(get_db)):
    c = _get(db, Character, cid)
    return _enqueue(db, "char_image", cid, c.project_id)


@router.post("/scenes/{sid}/image", response_model=S.TaskOut)
def gen_scene_image(sid: int, db: Session = Depends(get_db)):
    s = _get(db, Scene, sid)
    return _enqueue(db, "scene_image", sid, s.project_id)


@router.post("/props/{prid}/image", response_model=S.TaskOut)
def gen_prop_image(prid: int, db: Session = Depends(get_db)):
    pr = _get(db, Prop, prid)
    return _enqueue(db, "prop_image", prid, pr.project_id)


@router.post("/shots/{sid}/image", response_model=S.TaskOut)
def gen_shot_image(sid: int, db: Session = Depends(get_db)):
    s = _get(db, Shot, sid)
    return _enqueue(db, "shot_image", sid, s.episode.project_id)


@router.post("/shots/{sid}/video", response_model=S.TaskOut)
def gen_shot_video(sid: int, db: Session = Depends(get_db)):
    s = _get(db, Shot, sid)
    if not s.image_path:
        raise HTTPException(400, _("先生成首帧图，再生成视频", "Generate the first frame before the video"))
    return _enqueue(db, "shot_video", sid, s.episode.project_id)


# ---------- 批量生成 ----------
@router.post("/projects/{pid}/asset-images", response_model=list[S.TaskOut])
def gen_asset_images(pid: int, only_missing: bool = True, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    out = [_enqueue(db, "char_image", c.id, pid) for c in p.characters if not (only_missing and c.ref_image)]
    out += [_enqueue(db, "scene_image", s.id, pid) for s in p.scenes if not (only_missing and s.ref_image)]
    out += [_enqueue(db, "prop_image", x.id, pid) for x in p.props if not (only_missing and x.ref_image)]
    return out


@router.post("/episodes/{eid}/shot-images", response_model=list[S.TaskOut])
def gen_episode_images(eid: int, only_missing: bool = True, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    return [_enqueue(db, "shot_image", s.id, e.project_id)
            for s in e.shots if not (only_missing and s.image_path)]


@router.post("/episodes/{eid}/shot-videos", response_model=list[S.TaskOut])
def gen_episode_videos(eid: int, only_missing: bool = True, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    ready = [s for s in e.shots if s.image_path]
    if not ready:
        raise HTTPException(400, _("这一集还没有任何首帧图，先生成首帧", "This episode has no first frames yet — generate them first"))
    return [_enqueue(db, "shot_video", s.id, e.project_id)
            for s in ready if not (only_missing and s.video_path)]


# ---------- 上传自己的图 ----------
async def _save_upload(file: UploadFile, project_id: int, folder: str, stem: str) -> str:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in UPLOAD_EXTS:
        raise HTTPException(400, _("只支持 PNG / JPG / WEBP 图片", "Only PNG / JPG / WEBP images are supported"))
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, _("图片不能超过 20MB", "Image must not exceed 20MB"))
    rel = media.new_rel_path(project_id, folder, stem, suffix)
    dest = MEDIA_DIR / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel


@router.post("/characters/{cid}/upload", response_model=S.CharacterOut)
async def upload_character_image(cid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    c = _get(db, Character, cid)
    media.set_file(db, c, "ref_image", await _save_upload(file, c.project_id, "assets", f"char{c.id}"))
    return c


@router.post("/scenes/{sid}/upload", response_model=S.SceneOut)
async def upload_scene_image(sid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    s = _get(db, Scene, sid)
    media.set_file(db, s, "ref_image", await _save_upload(file, s.project_id, "assets", f"scene{s.id}"))
    return s


@router.post("/props/{prid}/upload", response_model=S.PropOut)
async def upload_prop_image(prid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    pr = _get(db, Prop, prid)
    media.set_file(db, pr, "ref_image", await _save_upload(file, pr.project_id, "assets", f"prop{pr.id}"))
    return pr


@router.post("/shots/{sid}/upload", response_model=S.ShotOut)
async def upload_shot_image(sid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    s = _get(db, Shot, sid)
    rel = await _save_upload(file, s.episode.project_id, f"e{s.episode_id}", f"shot{s.id}_frame")
    media.set_file(db, s, "image_path", rel)
    return s


# ---------- 配音 ----------
@router.post("/shots/{sid}/audio", response_model=S.TaskOut)
def gen_shot_audio(sid: int, db: Session = Depends(get_db)):
    s = _get(db, Shot, sid)
    if not audio.clean_line(s.dialogue) and not s.audio_path:
        raise HTTPException(400, _("这个镜头没有台词", "This shot has no dialogue"))
    return _enqueue(db, "shot_audio", sid, s.episode.project_id)


@router.post("/episodes/{eid}/shot-audios", response_model=list[S.TaskOut])
def gen_episode_audios(eid: int, only_missing: bool = True, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    cfg = settings_store.get(db, "tts") or {}
    return [_enqueue(db, "shot_audio", s.id, e.project_id) for s in e.shots
            if (audio.needs_audio(s, e.project, cfg) if only_missing else audio.clean_line(s.dialogue))]


@router.get("/tts/voices")
def list_voices():
    return tts.edge_voices()


class PreviewIn(BaseModel):
    voice: str
    text: str = "你好，这是一段配音试听。三年前那桩冤案，我一定会查个水落石出。"


@router.post("/tts/preview")
def preview_voice(body: PreviewIn, db: Session = Depends(get_db)):
    cfg = settings_store.get(db, "tts") or {}
    text = body.text.strip()[:200] or PreviewIn.model_fields["text"].default
    key = audio.audio_key(text, body.voice, cfg)
    rel = f"_preview/{key}.mp3"
    if not (MEDIA_DIR / rel).is_file():
        try:
            tts.synthesize(cfg, text, body.voice, MEDIA_DIR / rel)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, str(e)) from e
    return {"url": f"/media/{rel}"}


# ---------- 一键成片 ----------
class PipelineIn(BaseModel):
    target_seconds: int = 60
    redo_storyboard: bool = False
    with_video: bool = True


@router.post("/episodes/{eid}/pipeline", response_model=S.TaskOut)
def start_pipeline(eid: int, body: PipelineIn, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    if not e.shots and not e.script.strip():
        raise HTTPException(400, _("这一集还没有剧本，先把剧本写进去", "This episode has no script yet — write the script first"))
    t = tasks.enqueue(db, "pipeline", eid, e.project_id, body.model_dump(), max_attempts=1)
    return tasks.task_out(t)


@router.post("/tasks/{tid}/stop", response_model=S.TaskOut)
def stop_pipeline(tid: int, db: Session = Depends(get_db)):
    """停止一键成片：排队中的直接取消；执行中的在当前子任务结束后停下，并取消它排着的子任务。"""
    from ..models import Task
    from ..services import pipeline
    t = db.get(Task, tid)
    if not t or t.kind != "pipeline":
        raise HTTPException(404, _("不是一键成片任务", "Not a One-Click Episode task"))
    if t.status == "pending":
        return tasks.task_out(tasks.cancel(db, t))
    if t.status == "running":
        pipeline.request_stop(t.id)
        t.message = (t.message or "") + _("（正在停止…）", " (stopping…)")
        db.commit()
    return tasks.task_out(t)


# ---------- 合成 / 下载 ----------
@router.post("/episodes/{eid}/compose", response_model=S.TaskOut)
def compose_episode(eid: int, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    if not e.shots:
        raise HTTPException(400, _("这一集还没有镜头", "This episode has no shots yet"))
    lacking = [f"#{s.index}" for s in e.shots if not s.video_path and not s.image_path]
    if lacking:
        raise HTTPException(400, _(f"镜头 {'、'.join(lacking)} 还没有首帧或视频，先生成画面",
                                     f"Shot {', '.join(lacking)} has no first frame or video yet — generate the visuals first"))
    return _enqueue(db, "compose", eid, e.project_id)


@router.get("/episodes/{eid}/download")
def download_final(eid: int, kind: str = "mp4", db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    rel = e.srt_path if kind == "srt" else e.final_path
    if not rel or not (MEDIA_DIR / rel).is_file():
        raise HTTPException(404, _("还没有合成成片", "No final video has been composed yet"))
    name = re.sub(r'[\\/:*?"<>|]+', "_", f"{e.project.name}_第{e.index}集_{e.title}").strip("_ ")
    return FileResponse(MEDIA_DIR / rel, filename=f"{name}.{'srt' if kind == 'srt' else 'mp4'}")
