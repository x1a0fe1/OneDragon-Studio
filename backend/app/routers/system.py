"""设置与任务。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import prompts
from .. import schemas as S
from .. import settings_store
from ..db import get_db
from ..i18n import _
from ..models import LLMLog, Task
from ..providers import comfyui, llm
from ..services import ai, tasks

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/status")
def system_status(db: Session = Depends(get_db)):
    """欢迎页的系统状态：只做连通性检查，不调用大模型对话（不花 tokens、不记 AI 日志）。"""

    from ..models import Episode, Project
    from ..providers import ffmpeg

    cfg = settings_store.get_all(db)
    items = []

    llm_cfg = cfg.get("llm") or {}
    name = _(f"文本大模型（{llm_cfg.get('model') or '未选模型'}）",
             f"Text LLM ({llm_cfg.get('model') or 'no model selected'})")
    if not llm_cfg.get("model") or (llm.protocol(llm_cfg) != "anthropic" and not llm_cfg.get("base_url")):
        items.append({"key": "llm", "name": _("文本大模型", "Text LLM"), "state": "error",
                      "detail": _("还没有配置地址和模型", "Base URL and model are not configured yet")})
    else:
        try:
            llm.list_models(llm_cfg, timeout=8)  # 只查模型列表，不花 tokens
            items.append({"key": "llm", "name": name, "state": "ok", "detail": _("可以连接", "Connected")})
        except llm.LLMError as e:
            items.append({"key": "llm", "name": name, "state": "error", "detail": str(e)[:120]})
        except Exception:  # noqa: BLE001
            items.append({"key": "llm", "name": name, "state": "error",
                          "detail": _("连接失败，检查地址、网络或代理", "Connection failed — check the URL, network or proxy")})

    from ..providers import cloud
    providers = {cfg.get("image_provider"), cfg.get("video_provider")}
    for prov in sorted(p for p in providers if p in cloud.PROVIDERS):
        label = _(f"{cloud.provider_name(prov)} 生图 / 生视频", f"{cloud.provider_name(prov)} image / video generation")
        try:
            cloud.test(prov, cfg.get(prov) or {})
            items.append({"key": prov, "name": label, "state": "ok", "detail": _("API Key 有效（按张 / 按秒计费）",
                                                                                  "API key valid (billed per image / per second)")})
        except Exception as e:  # noqa: BLE001
            items.append({"key": prov, "name": label, "state": "error", "detail": str(e)[:120]})
    uses_comfy = "comfyui" in providers
    if uses_comfy:
        try:
            with comfyui.Client(cfg.get("comfyui") or {}) as client:
                client.stats()
            items.append({"key": "comfyui", "name": _("ComfyUI 生图 / 生视频", "ComfyUI image / video generation"),
                          "state": "ok", "detail": _("可以连接", "Connected")})
        except Exception:  # noqa: BLE001
            items.append({"key": "comfyui", "name": _("ComfyUI 生图 / 生视频", "ComfyUI image / video generation"),
                          "state": "error", "detail": _("连接失败，检查地址或 GPU 服务器是否开着",
                                                       "Connection failed — check the URL and that the GPU server is running")})
    elif "mock" in providers:
        items.append({"key": "comfyui", "name": _("生图 / 生视频", "Image / video generation"), "state": "warn",
                      "detail": _("演示模式：出占位图和占位视频。到设置里切到云端（百炼 / 方舟）或 ComfyUI 出真画面",
                                  "Demo mode: placeholder images and videos. Switch to a cloud provider (Model Studio / "
                                  "Volcano Engine Ark) or ComfyUI in Settings for real visuals")})

    tts_provider = (cfg.get("tts") or {}).get("provider", "edge")
    tts_names = {"edge": _("Edge 在线朗读（免费）", "Edge online TTS (free)"),
                 "openai": _("OpenAI 兼容接口", "OpenAI-compatible API"), "mock": _("静音占位", "Silent placeholder")}
    items.append({"key": "tts", "name": _("配音", "Voice-over"), "state": "warn" if tts_provider == "mock" else "ok",
                  "detail": tts_names.get(tts_provider, tts_provider)})

    from pathlib import Path
    ok = Path(ffmpeg.EXE).is_file()
    items.append({"key": "ffmpeg", "name": _("FFmpeg 合成", "FFmpeg composing"), "state": "ok" if ok else "error",
                  "detail": _("已就绪", "Ready") if ok else _("找不到 FFmpeg，重新安装后端依赖",
                                                                 "FFmpeg not found — reinstall the backend dependencies")})

    return {
        "items": items,
        "counts": {
            "projects": db.query(Project).count(),
            "episodes": db.query(Episode).count(),
            "active_tasks": db.query(Task).filter(Task.status.in_(["pending", "running"])).count(),
        },
    }


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return settings_store.masked(settings_store.get_all(db))


@router.put("/settings")
def put_settings(patch: dict, db: Session = Depends(get_db)):
    return settings_store.masked(settings_store.update(db, patch))


@router.post("/settings/test-llm")
def test_llm(db: Session = Depends(get_db)):
    try:
        reply = ai.chat([{"role": "user", "content": "只回复两个字：收到"}], purpose=_("测试连接", "Connection test"),
                        timeout=60, cfg=settings_store.get(db, "llm"))
    except llm.LLMError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "reply": reply.strip()[:100]}


@router.post("/settings/test-cloud/{provider}")
def test_cloud(provider: str, db: Session = Depends(get_db)):
    from ..providers import cloud
    if provider not in cloud.PROVIDERS:
        raise HTTPException(404, _("未知的平台", "Unknown platform"))
    try:
        return {"ok": True, "message": cloud.test(provider, settings_store.get(db, provider) or {})}
    except (cloud.CloudAbort, cloud.CloudError) as e:
        raise HTTPException(400, str(e)) from e


@router.post("/settings/llm-models")
def llm_models(db: Session = Depends(get_db)):
    """按当前（已保存的）大模型设置，从接口实时拉取模型列表。"""
    try:
        return {"models": llm.list_models(settings_store.get(db, "llm") or {})}
    except llm.LLMError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/settings/test-comfyui")
def test_comfyui(db: Session = Depends(get_db)):
    try:
        with comfyui.Client(settings_store.get(db, "comfyui")) as client:
            stats = client.stats()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e)) from e
    dev = (stats.get("devices") or [{}])[0]
    return {
        "ok": True,
        "version": (stats.get("system") or {}).get("comfyui_version", ""),
        "device": dev.get("name", ""),
        "vram_gb": round((dev.get("vram_total") or 0) / 1024**3, 1),
    }


_task_out = tasks.task_out


@router.get("/tasks", response_model=list[S.TaskOut])
def list_tasks(project_id: int | None = None, status: str | None = None, active: bool = False,
               limit: int = 100, db: Session = Depends(get_db)):
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    if status:
        q = q.filter(Task.status == status)
    if active:
        q = q.filter(Task.status.in_(["pending", "running"]))
    return [_task_out(t) for t in q.order_by(Task.id.desc()).limit(limit)]


@router.get("/tasks/{tid}", response_model=S.TaskOut)
def get_task(tid: int, db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        raise HTTPException(404, _("任务不存在", "Task not found"))
    return _task_out(t)


@router.post("/tasks/{tid}/retry", response_model=S.TaskOut)
def retry_task(tid: int, db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        raise HTTPException(404, _("任务不存在", "Task not found"))
    if t.status in ("pending", "running"):
        raise HTTPException(400, _("任务还在排队或执行中", "The task is still queued or running"))
    return _task_out(tasks.retry(db, t))


@router.post("/tasks/{tid}/cancel", response_model=S.TaskOut)
def cancel_task(tid: int, db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        raise HTTPException(404, _("任务不存在", "Task not found"))
    if t.status != "pending":
        raise HTTPException(400, _("只能取消还在排队的任务", "Only queued tasks can be cancelled"))
    return _task_out(tasks.cancel(db, t))


@router.post("/tasks/cancel-pending")
def cancel_pending(project_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Task).filter(Task.status == "pending")
    if project_id:
        q = q.filter(Task.project_id == project_id)
    n = q.update({"status": "failed", "message": _("已取消", "Cancelled")})
    db.commit()
    return {"cancelled": n}


# ---------- 提示词模板 ----------
@router.get("/prompts")
def list_prompts(db: Session = Depends(get_db)):
    return prompts.listing(db)


# ---------- AI 日志 ----------
@router.get("/llm-logs", response_model=list[S.LLMLogBrief])
def list_llm_logs(status: str | None = None, purpose: str | None = None, limit: int = 200,
                  db: Session = Depends(get_db)):
    q = db.query(LLMLog)
    if status:
        q = q.filter(LLMLog.status == status)
    if purpose:
        q = q.filter(LLMLog.purpose == purpose)
    return q.order_by(LLMLog.id.desc()).limit(min(limit, 500)).all()


@router.get("/llm-logs/{lid}", response_model=S.LLMLogOut)
def get_llm_log(lid: int, db: Session = Depends(get_db)):
    row = db.get(LLMLog, lid)
    if not row:
        raise HTTPException(404, _("日志不存在", "Log not found"))
    return row


@router.delete("/llm-logs")
def clear_llm_logs(db: Session = Depends(get_db)):
    n = db.query(LLMLog).delete()
    db.commit()
    return {"deleted": n}
