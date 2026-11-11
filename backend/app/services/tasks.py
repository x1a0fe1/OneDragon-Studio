"""轻量任务队列：任务存 SQLite，后台线程按「通道」逐个执行；失败自动重试；进程重启后未完成的任务继续跑。

四条通道互不阻塞：text（拆分镜、配音）、media（生图、生视频，GPU 一次只跑一个）、compose（FFmpeg 合成）、
pipeline（一键成片：负责排子任务、等结果，本身不干重活）。

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
    "storyboard": "AI 拆分镜",
    "char_image": "角色参考图",
    "scene_image": "场景参考图",
    "prop_image": "道具参考图",
    "shot_image": "镜头首帧",
    "shot_video": "镜头视频",
    "shot_audio": "台词配音",
    "compose": "合成成片",
    "pipeline": "一键成片",
}

LANES = {
    "text": {"storyboard", "shot_audio"},
    "media": {"char_image", "scene_image", "prop_image", "shot_image", "shot_video"},
    "compose": {"compose"},
    "pipeline": {"pipeline"},
}


def task_out(t: Task) -> S.TaskOut:
    return S.TaskOut.model_validate(t).model_copy(update={"kind_label": KIND_LABELS.get(t.kind, t.kind)})


def enqueue(db: Session, kind: str, target_id: int, project_id: int = 0, params: dict | None = None,
            max_attempts: int | None = None) -> Task:
    if kind not in HANDLERS:
        raise ValueError(f"未知任务类型：{kind}")
    # 同一对象同一类任务还在排队/执行，就不重复建
    existing = (db.query(Task)
                .filter(Task.kind == kind, Task.target_id == target_id,
                        Task.status.in_(["pending", "running"]))
                .first())
    if existing:
        return existing
    if max_attempts is None:
        max_attempts = int((settings_store.get(db, "worker") or {}).get("max_attempts", 3))
    t = Task(kind=kind, target_id=target_id, project_id=project_id,
             params=params or {}, max_attempts=max_attempts)
    db.add(t)
    db.commit()
    db.refresh(t)
    _wake_all()
    return t


def retry(db: Session, task: Task) -> Task:
    task.status, task.attempts, task.error, task.message = "pending", 0, "", "重新排队"
    db.commit()
    _wake_all()
    return task


def cancel(db: Session, task: Task) -> Task:
    """只能取消还在排队的任务；正在执行的会跑完。"""
    task.status, task.message = "failed", "已取消"
    db.commit()
    return task


_stop = threading.Event()
_wake = {lane: threading.Event() for lane in LANES}


def is_stopping() -> bool:
    return _stop.is_set()


def _wake_all():
    for ev in _wake.values():
        ev.set()


def _run_one(kinds: set[str]) -> bool:
    db = SessionLocal()
    try:
        task = (db.query(Task).filter(Task.status == "pending", Task.kind.in_(kinds))
                .order_by(Task.id).first())
        if not task:
            return False
        task.status, task.message = "running", "执行中…"
        task.attempts += 1
        db.commit()
        try:
            msg = HANDLERS[task.kind](db, task)
            task.status, task.message, task.error = "done", msg or "完成", ""
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
                task.status, task.message = "pending", f"第 {task.attempts} 次失败，稍后重试：{e}"
            else:
                task.status, task.message = "failed", f"失败（已重试 {task.attempts} 次）：{e}"
        db.commit()
        if task.status == "pending":  # 失败重试前退避一下
            _stop.wait(min(30, 5 * task.attempts))
        return True
    finally:
        db.close()


def _loop(lane: str):
    kinds = LANES[lane]
    while not _stop.is_set():
        try:
            busy = _run_one(kinds)
        except Exception:  # noqa: BLE001
            log.exception("任务循环异常（%s）", lane)
            busy = False
        if not busy:
            _wake[lane].wait(3)
            _wake[lane].clear()


_threads: list[threading.Thread] = []


def start_worker():
    # 上次没跑完就被关掉的任务，恢复成排队状态
    db = SessionLocal()
    try:
        db.query(Task).filter(Task.status == "running").update({"status": "pending", "message": "服务重启，重新排队"})
        db.commit()
    finally:
        db.close()
    _stop.clear()
    for lane in LANES:
        t = threading.Thread(target=_loop, args=(lane,), name=f"onedragon-{lane}", daemon=True)
        t.start()
        _threads.append(t)


def stop_worker():
    _stop.set()
    _wake_all()
    for t in _threads:
        t.join(timeout=5)
    _threads.clear()
