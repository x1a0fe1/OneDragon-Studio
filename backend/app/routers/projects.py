"""项目、分集、角色、场景、道具、镜头的增删改查；导入故事/小说拆分集。"""
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import schemas as S
from ..db import get_db
from ..i18n import _
from ..models import Character, Episode, Project, Prop, Scene, Shot, Task
from ..providers import llm
from ..services import media, novel, storyboard, tasks

MAX_NOVEL = 30 * 1024 * 1024

router = APIRouter(prefix="/api", tags=["projects"])


def _get(db: Session, model, obj_id: int):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(404, _(f"{model.__name__} {obj_id} 不存在", f"{model.__name__} {obj_id} not found"))
    return obj


def _patch(obj, patch):
    for k, v in patch.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)


# ---------- 项目 ----------
@router.get("/projects", response_model=list[S.ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.id.desc()).all()


@router.post("/projects", response_model=S.ProjectOut)
def create_project(body: S.ProjectIn, db: Session = Depends(get_db)):
    p = Project(**body.model_dump())
    db.add(p)
    db.commit()
    return p


@router.get("/projects/{pid}", response_model=S.ProjectDetail)
def get_project(pid: int, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    out = S.ProjectDetail.model_validate(p)
    out.episodes = [S.EpisodeBrief(id=e.id, project_id=e.project_id, index=e.index,
                                   title=e.title, shot_count=len(e.shots)) for e in p.episodes]
    return out


@router.patch("/projects/{pid}", response_model=S.ProjectOut)
def update_project(pid: int, body: S.ProjectPatch, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    _patch(p, body)
    db.commit()
    return p


@router.delete("/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Project, pid))
    db.commit()
    media.remove_dir(f"p{pid}")
    return {"ok": True}


# ---------- 分集 ----------
@router.post("/projects/{pid}/episodes", response_model=S.EpisodeOut)
def create_episode(pid: int, body: S.EpisodeIn, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    idx = body.index or (max((e.index for e in p.episodes), default=0) + 1)
    e = Episode(project_id=pid, index=idx, title=body.title or f"第{idx}集", script=body.script)
    db.add(e)
    db.commit()
    return e


@router.get("/episodes/{eid}", response_model=S.EpisodeOut)
def get_episode(eid: int, db: Session = Depends(get_db)):
    return _get(db, Episode, eid)


@router.patch("/episodes/{eid}", response_model=S.EpisodeOut)
def update_episode(eid: int, body: S.EpisodePatch, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    _patch(e, body)
    db.commit()
    return e


@router.delete("/episodes/{eid}")
def delete_episode(eid: int, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    pid = e.project_id
    db.delete(e)
    db.commit()
    media.remove_dir(f"p{pid}/e{eid}")
    return {"ok": True}


@router.post("/episodes/{eid}/storyboard", response_model=S.TaskOut)
def run_storyboard(eid: int, target_seconds: int = 60, db: Session = Depends(get_db)):
    e = _get(db, Episode, eid)
    if not e.script.strip():
        raise HTTPException(400, _("先填写剧本再拆分镜", "Write a script before generating the storyboard"))
    t = tasks.enqueue(db, "storyboard", eid, e.project_id, {"target_seconds": target_seconds})
    return tasks.task_out(t)


@router.get("/episodes/{eid}/storyboard-prompt")
def storyboard_prompt(eid: int, target_seconds: int = 60, db: Session = Depends(get_db)):
    """拆分镜提示词：复制到 Claude / ChatGPT 等聊天网页里用，结果再用下面的接口粘贴回来。"""
    e = _get(db, Episode, eid)
    try:
        system, user = storyboard.build_messages(db, e, target_seconds)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {"text": f"{system}\n\n---\n\n{user}\n\n---\n\n"
                    "请严格按上面的 JSON 结构，只输出一段完整的 JSON，不要加任何解释文字。"}


class PastedStoryboard(BaseModel):
    text: str


@router.post("/episodes/{eid}/storyboard-import")
def storyboard_import(eid: int, body: PastedStoryboard, db: Session = Depends(get_db)):
    """导入从聊天网页复制回来的分镜 JSON，效果和 AI 拆分镜一样：镜头整表替换，角色/场景/道具按名字合并。"""
    e = _get(db, Episode, eid)
    busy = db.query(Task).filter(Task.kind.in_(["storyboard", "pipeline"]), Task.target_id == eid,
                                 Task.status.in_(["pending", "running"])).first()
    if busy:
        raise HTTPException(409, _("这一集正在 AI 拆分镜或一键成片，等它结束再导入",
                                   "This episode is being storyboarded or run by One-Click; import after it finishes"))
    try:
        data = storyboard.parse_pasted(body.text)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {"message": storyboard.apply(db, e, data)}


# ---------- 角色 / 场景 ----------
@router.post("/projects/{pid}/characters", response_model=S.CharacterOut)
def create_character(pid: int, body: S.CharacterIn, db: Session = Depends(get_db)):
    _get(db, Project, pid)
    c = Character(project_id=pid, **body.model_dump())
    db.add(c)
    db.commit()
    return c


@router.patch("/characters/{cid}", response_model=S.CharacterOut)
def update_character(cid: int, body: S.CharacterPatch, db: Session = Depends(get_db)):
    c = _get(db, Character, cid)
    _patch(c, body)
    db.commit()
    return c


@router.delete("/characters/{cid}")
def delete_character(cid: int, db: Session = Depends(get_db)):
    c = _get(db, Character, cid)
    db.delete(c)
    db.commit()
    media.remove_file(c.ref_image)
    return {"ok": True}


@router.post("/projects/{pid}/scenes", response_model=S.SceneOut)
def create_scene(pid: int, body: S.SceneIn, db: Session = Depends(get_db)):
    _get(db, Project, pid)
    s = Scene(project_id=pid, **body.model_dump())
    db.add(s)
    db.commit()
    return s


@router.patch("/scenes/{sid}", response_model=S.SceneOut)
def update_scene(sid: int, body: S.ScenePatch, db: Session = Depends(get_db)):
    s = _get(db, Scene, sid)
    _patch(s, body)
    db.commit()
    return s


@router.delete("/scenes/{sid}")
def delete_scene(sid: int, db: Session = Depends(get_db)):
    s = _get(db, Scene, sid)
    db.delete(s)
    db.commit()
    media.remove_file(s.ref_image)
    return {"ok": True}


@router.post("/projects/{pid}/props", response_model=S.PropOut)
def create_prop(pid: int, body: S.PropIn, db: Session = Depends(get_db)):
    _get(db, Project, pid)
    pr = Prop(project_id=pid, **body.model_dump())
    db.add(pr)
    db.commit()
    return pr


@router.patch("/props/{prid}", response_model=S.PropOut)
def update_prop(prid: int, body: S.PropPatch, db: Session = Depends(get_db)):
    pr = _get(db, Prop, prid)
    _patch(pr, body)
    db.commit()
    return pr


@router.delete("/props/{prid}")
def delete_prop(prid: int, db: Session = Depends(get_db)):
    pr = _get(db, Prop, prid)
    db.delete(pr)
    db.commit()
    media.remove_file(pr.ref_image)
    return {"ok": True}


# ---------- 导入故事 / 小说 ----------
@router.post("/projects/{pid}/import/preview", response_model=S.ImportPreview)
async def import_preview(pid: int, mode: str = Form("chapter"), size: int = Form(1500),
                         text: str = Form(""), file: UploadFile | None = File(None),
                         db: Session = Depends(get_db)):
    """读文件或粘贴的文字，按选的方式拆成若干集，先给用户看，不写数据库。"""
    _get(db, Project, pid)
    epub = None
    source = _("粘贴的文本", "Pasted text")
    if file is not None and file.filename:
        source = file.filename
        data = await file.read(MAX_NOVEL + 1)
        if len(data) > MAX_NOVEL:
            raise HTTPException(400, _("文件不能超过 30MB", "File must not exceed 30MB"))
        suffix = Path(file.filename).suffix.lower()
        try:
            if suffix == ".epub":
                epub = novel.read_epub(data)
                text = "\n\n".join(c["title"] + "\n" + c["text"] for c in epub)
            elif suffix in (".txt", ".md", ""):
                text = novel.decode_text(data)
            else:
                raise HTTPException(400, _("只支持 TXT / EPUB / Markdown 文件", "Only TXT / EPUB / Markdown files are supported"))
        except novel.ImportErrorMsg as e:
            raise HTTPException(400, str(e)) from e
    try:
        # AI 分集要等大模型，放到线程里跑，别卡住其他请求
        chapters, note = await run_in_threadpool(novel.split, text, mode, size, pid, epub)
    except (novel.ImportErrorMsg, llm.LLMError) as e:
        raise HTTPException(400, str(e)) from e
    return S.ImportPreview(
        source=source, note=note, total_chars=sum(len(c["text"]) for c in chapters),
        chapters=[S.ChapterPreview(title=c["title"], text=c["text"], chars=len(c["text"])) for c in chapters])


@router.post("/projects/{pid}/import/commit", response_model=list[S.EpisodeBrief])
def import_commit(pid: int, body: S.ImportCommit, db: Session = Depends(get_db)):
    """把确认过的分集接在现有分集后面。"""
    p = _get(db, Project, pid)
    chapters = [c for c in body.chapters if c.text.strip()]
    if not chapters:
        raise HTTPException(400, _("没有选中任何一集", "No episodes selected"))
    start = max((e.index for e in p.episodes), default=0)
    created = []
    for n, c in enumerate(chapters, 1):
        idx = start + n
        e = Episode(project_id=pid, index=idx, title=c.title.strip()[:200] or f"第{idx}集", script=c.text.strip())
        db.add(e)
        created.append(e)
    db.commit()
    return [S.EpisodeBrief(id=e.id, project_id=pid, index=e.index, title=e.title, shot_count=0) for e in created]


# ---------- 镜头 ----------
@router.patch("/shots/{sid}", response_model=S.ShotOut)
def update_shot(sid: int, body: S.ShotPatch, db: Session = Depends(get_db)):
    s = _get(db, Shot, sid)
    _patch(s, body)
    db.commit()
    return s


@router.post("/episodes/{eid}/shots", response_model=S.ShotOut)
def add_shot(eid: int, after_index: int | None = None, db: Session = Depends(get_db)):
    """在 after_index 之后插入一个空镜头；不传就追加到末尾。"""
    e = _get(db, Episode, eid)
    pos = len(e.shots) + 1 if after_index is None else after_index + 1
    for s in e.shots:
        if s.index >= pos:
            s.index += 1
    shot = Shot(episode_id=eid, index=pos, character_names=[])
    db.add(shot)
    db.commit()
    return shot


@router.delete("/shots/{sid}")
def delete_shot(sid: int, db: Session = Depends(get_db)):
    s = _get(db, Shot, sid)
    ep = s.episode
    db.delete(s)
    db.flush()
    for i, other in enumerate(sorted((x for x in ep.shots if x.id != sid), key=lambda x: x.index), 1):
        other.index = i
    db.commit()
    for f in (s.image_path, s.video_path, s.audio_path):
        if f:
            media.remove_file(f)
    return {"ok": True}
