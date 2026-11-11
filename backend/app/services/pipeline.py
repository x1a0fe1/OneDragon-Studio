"""一键成片：把一集从剧本一路跑到成片。

它本身是一个任务（kind=pipeline，单独一条通道），按步骤把子任务放进队列、等它们跑完，再进入下一步：
  1 AI 拆分镜（这集还没有镜头，或者选了「重新拆分镜」）
  2 这集用到的角色 / 场景 / 道具参考图（只补缺的）
  3 镜头首帧（只补缺的）
  4 镜头视频（只补缺的；可以选不生成，合成时用首帧静帧）
  5 台词配音（没配的、台词改过的）
  6 合成成片
任何一步有子任务最终失败就停下来，告诉用户是哪个镜头、什么原因；修好后再点一次会从缺的地方接着跑。
"""
import threading
import time

from sqlalchemy.orm import Session

from .. import settings_store
from ..models import Episode, Task
from . import audio
from .errors import TaskAbort

STEPS = ["AI 拆分镜", "参考图", "镜头首帧", "镜头视频", "台词配音", "合成成片"]

# 用户点了「停止」的流水线任务 id（同一进程内）
_stop_requested: set[int] = set()
_lock = threading.Lock()


class Shutdown(Exception):
    """服务正在关闭：流水线保持 running，下次启动会被重置为排队，接着跑。"""


def request_stop(task_id: int) -> None:
    with _lock:
        _stop_requested.add(task_id)


def _should_stop(task_id: int) -> bool:
    with _lock:
        return task_id in _stop_requested


def _clear_stop(task_id: int) -> None:
    with _lock:
        _stop_requested.discard(task_id)


def run(db: Session, task: Task) -> str:
    from . import tasks  # 避免循环导入

    _clear_stop(task.id)
    opts = task.params or {}
    ep = db.get(Episode, task.target_id)
    if not ep:
        raise TaskAbort("这一集已被删除")
    pid = ep.project_id
    with_video = bool(opts.get("with_video", True))
    report_state = {"last": ""}

    def report(step: int, detail: str = ""):
        msg = f"第 {step}/{len(STEPS)} 步 {STEPS[step - 1]}" + (f"：{detail}" if detail else "")
        if msg != report_state["last"]:
            task.message = msg
            task.params = {**opts, "step": step}
            db.commit()
            report_state["last"] = msg

    def wait(step: int, children: list[Task], what: str):
        """等子任务全部结束；有失败的就停下来。"""
        ids = [c.id for c in children]
        if not ids:
            report(step, f"{what}都已经有了，跳过")
            return
        while True:
            if tasks.is_stopping():
                raise Shutdown()
            if _should_stop(task.id):
                _cancel_children(db, ids)
                raise TaskAbort(f"已停止（在第 {step} 步 {STEPS[step - 1]}）")
            db.expire_all()
            rows = db.query(Task).filter(Task.id.in_(ids)).all()
            done = [r for r in rows if r.status == "done"]
            failed = [r for r in rows if r.status == "failed"]
            if failed and len(done) + len(failed) == len(rows):
                first = failed[0]
                more = f" 等 {len(failed)} 个" if len(failed) > 1 else ""
                raise TaskAbort(f"第 {step} 步 {STEPS[step - 1]} 失败{more}：{_target_label(db, first)} —— "
                                f"{(first.message or first.error).splitlines()[0][:200]}。修好后再点「一键成片」会从这里接着跑")
            running = next((r for r in rows if r.status == "running"), None)
            detail = f"{len(done)}/{len(rows)} 个{what}"
            if running and running.message and running.message not in ("执行中…",):
                detail += f" · {running.message[:40]}"
            report(step, detail)
            if len(done) == len(rows):
                return
            time.sleep(2)

    # 1 拆分镜
    db.refresh(ep)
    if opts.get("redo_storyboard") or not ep.shots:
        if not ep.script.strip():
            raise TaskAbort("这一集还没有剧本，先把剧本写进去")
        report(1, "大模型正在拆分镜…")
        child = tasks.enqueue(db, "storyboard", ep.id, pid, {"target_seconds": int(opts.get("target_seconds") or 60)})
        wait(1, [child], "拆分镜任务")
        opts = {**opts, "redo_storyboard": False}  # 中途重启不要再拆一遍
        task.params = opts
        db.commit()
    else:
        report(1, f"已有 {len(ep.shots)} 个镜头，跳过")
    db.expire_all()
    ep = db.get(Episode, ep.id)
    project = ep.project
    if not ep.shots:
        raise TaskAbort("拆分镜没有得到任何镜头")

    # 2 参考图：只管这一集用到的
    used_chars = {n for s in ep.shots for n in s.character_names or []}
    used_props = {n for s in ep.shots for n in s.prop_names or []}
    used_scenes = {s.scene_name for s in ep.shots if s.scene_name}
    children = [tasks.enqueue(db, "char_image", c.id, pid) for c in project.characters
                if c.name in used_chars and not c.ref_image]
    children += [tasks.enqueue(db, "scene_image", s.id, pid) for s in project.scenes
                 if s.name in used_scenes and not s.ref_image]
    children += [tasks.enqueue(db, "prop_image", p.id, pid) for p in project.props
                 if p.name in used_props and not p.ref_image]
    wait(2, children, "参考图")

    # 3 首帧
    db.expire_all()
    ep = db.get(Episode, ep.id)
    wait(3, [tasks.enqueue(db, "shot_image", s.id, pid) for s in ep.shots if not s.image_path], "首帧")

    # 4 视频
    db.expire_all()
    ep = db.get(Episode, ep.id)
    if with_video:
        wait(4, [tasks.enqueue(db, "shot_video", s.id, pid) for s in ep.shots if not s.video_path], "视频")
    else:
        report(4, "已选择不生成视频，合成时用首帧画面")

    # 5 配音
    db.expire_all()
    ep = db.get(Episode, ep.id)
    tts_cfg = settings_store.get(db, "tts") or {}
    wait(5, [tasks.enqueue(db, "shot_audio", s.id, pid) for s in ep.shots
             if audio.needs_audio(s, ep.project, tts_cfg)], "配音")

    # 6 合成
    child = tasks.enqueue(db, "compose", ep.id, pid)
    wait(6, [child], "合成任务")
    db.expire_all()
    ep = db.get(Episode, ep.id)
    _clear_stop(task.id)
    return f"成片已完成：{len(ep.shots)} 个镜头，{ep.final_duration:.1f} 秒"


def _cancel_children(db: Session, ids: list[int]) -> None:
    db.query(Task).filter(Task.id.in_(ids), Task.status == "pending").update(
        {"status": "failed", "message": "已取消"}, synchronize_session=False)
    db.commit()


def _target_label(db: Session, t: Task) -> str:
    from ..models import Character, Prop, Scene, Shot
    model = {"char_image": Character, "scene_image": Scene, "prop_image": Prop,
             "shot_image": Shot, "shot_video": Shot, "shot_audio": Shot}.get(t.kind)
    obj = db.get(model, t.target_id) if model else None
    if isinstance(obj, Shot):
        return f"镜头 #{obj.index}"
    if obj is not None:
        return f"「{obj.name}」"
    return t.kind
