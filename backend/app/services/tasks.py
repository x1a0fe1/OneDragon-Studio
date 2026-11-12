"""轻量任务队列：任务存 SQLite，后台线程按「通道」逐个执行；失败自动重试；进程重启后未完成的任务继续跑。

四条通道互不阻塞：text（拆分镜、配音）、media（生图、生视频）、compose（FFmpeg 合成）、
pipeline（一键成片：负责排子任务、等结果，本身不干重活）。
media 通道用 ComfyUI（自己的 GPU）时一次只跑一个；全走云端平台时可以同时跑几个（设置 worker.media_concurrency）。

新增一种任务：写一个 handler(db, task) -> str（返回结果说明），注册到 HANDLERS、KIND_LABELS 和 LANES。
handler 里抛 TaskAbort 表示不用重试，直接失败。
"""
import logging
import threading
import traceback

from sqlalchemy.orm import Session

from .. import schemas as S
from .. import settings_store
from ..db import SessionLocal
from ..models import Task
from . import audio, compose, media, pipeline, storyboard
from .errors import TaskAbort
from ..i18n import _, get_lang, set_lang

log = logging.getLogger("onedragon.tasks")


def _storyboard(db: Session, task: Task) -> str:
    return storyboard.generate(db, task.target_id, int(task.params.get("target_seconds") or 60))


HANDLERS = {
    "storyboard": _storyboard,
    "char_image": media.character_image,
    "scene_image": media.scene_image,
    "prop_image": media.prop_image,
    "shot_image": media.shot_image,
    "shot_video": media.shot_video,
    "shot_audio": audio.shot_audio,
    "compose": compose.compose_episode,
    "pipeline": pipeline.run,
}

KIND_LABELS = {
    "storyboard": ("AI 拆分镜", "AI Storyboard"),
    "char_image": ("角色参考图", "Character reference image"),
    "scene_image": ("场景参考图", "Scene reference image"),
    "prop_image": ("道具参考图", "Prop reference image"),
    "shot_image": ("镜头首帧", "Shot first frame"),
    "shot_video": ("镜头视频", "Shot video"),
    "shot_audio": ("台词配音", "Dialogue voice-over"),
    "compose": ("合成成片", "Compose final video"),
    "pipeline": ("一键成片", "One-Click Episode"),
}

LANES = {
    "text": {"storyboard", "shot_audio"},
    "media": {"char_image", "scene_image", "prop_image", "shot_image", "shot_video"},
    "compose": {"compose"},
    "pipeline": {"pipeline"},
}


def task_out(t: Task) -> S.TaskOut:
    label = KIND_LABELS.get(t.kind)
    return S.TaskOut.model_validate(t).model_copy(update={"kind_label": _(*label) if label else t.kind})


def enqueue(db: Session, kind: str, target_id: int, project_id: int = 0, params: dict | None = None,
            max_attempts: int | None = None) -> Task:
    if kind not in HANDLERS:
        raise ValueError(_(f"未知任务类型：{kind}", f"Unknown task type: {kind}"))
    # 同一对象同一类任务还在排队/执行，就不重复建
    existing = (db.query(Task)
                .filter(Task.kind == kind, Task.target_id == target_id,
                        Task.status.in_(["pending", "running"]))
                .first())
    if existing:
        return existing
    if max_attempts is None:
        max_attempts = int((settings_store.get(db, "worker") or {}).get("max_attempts", 3))
    # 记住发起任务时的界面语言，执行时进度和报错用同一种语言
    t = Task(kind=kind, target_id=target_id, project_id=project_id,
             params={**(params or {}), "lang": (params or {}).get("lang") or get_lang()}, max_attempts=max_attempts)
    db.add(t)
    db.commit()
    db.refresh(t)
    _wake_all()
    return t


def retry(db: Session, task: Task) -> Task:
    task.status, task.attempts, task.error, task.message = "pending", 0, "", _("重新排队", "Re-queued")
    db.commit()
    _wake_all()
    return task


def cancel(db: Session, task: Task) -> Task:
    """只能取消还在排队的任务；正在执行的会跑完。"""
    task.status, task.message = "failed", _("已取消", "Cancelled")
    db.commit()
    return task


_stop = threading.Event()
_wake = {lane: threading.Event() for lane in LANES}
_claim_lock = threading.Lock()  # 同一通道多个线程时，取任务要互斥，免得两个线程抢到同一个
MAX_MEDIA_THREADS = 4


def media_slots(db: Session) -> int:
    """media 通道现在允许几个线程同时干活：用到 ComfyUI 就只能 1 个（一块 GPU），全是云端/演示就按设置。"""
    if "comfyui" in (settings_store.get(db, "image_provider"), settings_store.get(db, "video_provider")):
        return 1
    try:
        n = int((settings_store.get(db, "worker") or {}).get("media_concurrency") or 2)
    except (TypeError, ValueError):
        n = 2
    return max(1, min(MAX_MEDIA_THREADS, n))


def is_stopping() -> bool:
    return _stop.is_set()


def _wake_all():
    for ev in _wake.values():
        ev.set()


def _run_one(kinds: set[str], slot: int = 0) -> bool:
    db = SessionLocal()
    try:
        if slot and slot >= media_slots(db):
            return False  # 这个额外线程当前没被启用（并发数没那么多，或者在用 ComfyUI）
        with _claim_lock:
            task = (db.query(Task).filter(Task.status == "pending", Task.kind.in_(kinds))
                    .order_by(Task.id).first())
            if not task:
                return False
            set_lang((task.params or {}).get("lang"))
            task.status, task.message = "running", _("执行中…", "Running…")
            task.attempts += 1
            db.commit()
        try:
            msg = HANDLERS[task.kind](db, task)
            task.status, task.message, task.error = "done", msg or _("完成", "Done"), ""
        except pipeline.Shutdown:
            db.rollback()
            return True  # 保持 running，下次启动重置为排队接着跑
        except TaskAbort as e:
            db.rollback()
            task.status, task.message, task.error = "failed", str(e), str(e)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            log.warning("任务 %s(%s) 第 %d 次失败：%s", task.id, task.kind, task.attempts, e)
            task.error = f"{e}\n\n{traceback.format_exc(limit=3)}"
            if task.attempts < task.max_attempts:
                task.status, task.message = "pending", _(f"第 {task.attempts} 次失败，稍后重试：{e}",
                                                         f"Attempt {task.attempts} failed, retrying shortly: {e}")
            else:
                task.status, task.message = "failed", _(f"失败（已重试 {task.attempts} 次）：{e}",
                                                        f"Failed (after {task.attempts} attempts): {e}")
        db.commit()
        if task.status == "pending":  # 失败重试前退避一下
            _stop.wait(min(30, 5 * task.attempts))
        return True
    finally:
        db.close()


def _loop(lane: str, slot: int = 0):
    kinds = LANES[lane]
    while not _stop.is_set():
        try:
            busy = _run_one(kinds, slot)
        except Exception:  # noqa: BLE001
            log.exception("任务循环异常（%s #%d）", lane, slot)
            busy = False
        if not busy:
            # 多个线程共用一个唤醒信号：只有 0 号负责清除，其他线程最多睡 3 秒自己醒
            _wake[lane].wait(3)
            if slot == 0:
                _wake[lane].clear()


_threads: list[threading.Thread] = []


def start_worker():
    # 上次没跑完就被关掉的任务，恢复成排队状态
    db = SessionLocal()
    try:
        db.query(Task).filter(Task.status == "running").update({"status": "pending", "message": _("服务重启，重新排队", "Server restarted, re-queued")})
        db.commit()
    finally:
        db.close()
    _stop.clear()
    for lane in LANES:
        for slot in range(MAX_MEDIA_THREADS if lane == "media" else 1):
            t = threading.Thread(target=_loop, args=(lane, slot), name=f"onedragon-{lane}-{slot}", daemon=True)
            t.start()
            _threads.append(t)


def stop_worker():
    _stop.set()
    _wake_all()
    for t in _threads:
        t.join(timeout=5)
    _threads.clear()
