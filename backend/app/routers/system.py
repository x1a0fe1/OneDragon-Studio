"""设置与任务。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import prompts
from .. import schemas as S
from .. import settings_store
from ..db import get_db
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
    import httpx

    from ..models import Episode, Project
    from ..providers import ffmpeg

    cfg = settings_store.get_all(db)
    items = []

    llm_cfg = cfg.get("llm") or {}
    if not (llm_cfg.get("base_url") and llm_cfg.get("model")):
        items.append({"key": "llm", "name": "文本大模型", "state": "error", "detail": "还没有配置地址和模型"})
    elif not llm_cfg.get("api_key") and "127.0.0.1" not in llm_cfg["base_url"] and "localhost" not in llm_cfg["base_url"]:
        items.append({"key": "llm", "name": f"文本大模型（{llm_cfg['model']}）", "state": "error", "detail": "还没有填 API Key"})
    else:
        url = llm.endpoint(llm_cfg["base_url"]).rsplit("/chat/completions", 1)[0] + "/models"
        headers = {"Authorization": f"Bearer {llm_cfg['api_key']}"} if llm_cfg.get("api_key") else {}
        try:
            r = httpx.get(url, headers=headers, timeout=5)
            if r.status_code in (401, 403):
                state, detail = "error", "API Key 无效或没有权限"
            else:
                state, detail = "ok", "可以连接"
        except httpx.HTTPError:
            state, detail = "error", "连接失败，检查地址和网络"
        items.append({"key": "llm", "name": f"文本大模型（{llm_cfg['model']}）", "state": state, "detail": detail})

    from ..providers import cloud
    providers = {cfg.get("image_provider"), cfg.get("video_provider")}
    for prov in sorted(p for p in providers if p in cloud.PROVIDERS):
        label = f"{cloud.PROVIDERS[prov]} 生图 / 生视频"
        try:
            cloud.test(prov, cfg.get(prov) or {})
            items.append({"key": prov, "name": label, "state": "ok", "detail": "API Key 有效（按张 / 按秒计费）"})
        except Exception as e:  # noqa: BLE001
            items.append({"key": prov, "name": label, "state": "error", "detail": str(e)[:120]})
    uses_comfy = "comfyui" in providers
    if uses_comfy:
        try:
            with comfyui.Client(cfg.get("comfyui") or {}) as client:
                client.stats()
            items.append({"key": "comfyui", "name": "ComfyUI 生图 / 生视频", "state": "ok", "detail": "可以连接"})
        except Exception:  # noqa: BLE001
            items.append({"key": "comfyui", "name": "ComfyUI 生图 / 生视频", "state": "error", "detail": "连接失败，检查地址或 GPU 服务器是否开着"})
    elif "mock" in providers:
        items.append({"key": "comfyui", "name": "生图 / 生视频", "state": "warn",
                      "detail": "演示模式：出占位图和占位视频。到设置里切到云端（百炼 / 方舟）或 ComfyUI 出真画面"})

    tts_provider = (cfg.get("tts") or {}).get("provider", "edge")
    tts_names = {"edge": "Edge 在线朗读（免费）", "openai": "OpenAI 兼容接口", "mock": "静音占位"}
    items.append({"key": "tts", "name": "配音", "state": "warn" if tts_provider == "mock" else "ok",
                  "detail": tts_names.get(tts_provider, tts_provider)})

    from pathlib import Path
    ok = Path(ffmpeg.EXE).is_file()
    items.append({"key": "ffmpeg", "name": "FFmpeg 合成", "state": "ok" if ok else "error",
                  "detail": "已就绪" if ok else "找不到 FFmpeg，重新安装后端依赖"})

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
        reply = ai.chat([{"role": "user", "content": "只回复两个字：收到"}], purpose="测试连接",
                        timeout=60, cfg=settings_store.get(db, "llm"))
    except llm.LLMError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "reply": reply.strip()[:100]}


@router.post("/settings/test-cloud/{provider}")
def test_cloud(provider: str, db: Session = Depends(get_db)):
    from ..providers import cloud
    if provider not in cloud.PROVIDERS:
        raise HTTPException(404, "未知的平台")
    try:
        return {"ok": True, "message": cloud.test(provider, settings_store.get(db, provider) or {})}
    except (cloud.CloudAbort, cloud.CloudError) as e:
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
        raise HTTPException(404, "任务不存在")
    return _task_out(t)


@router.post("/tasks/{tid}/retry", response_model=S.TaskOut)
def retry_task(tid: int, db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    if t.status in ("pending", "running"):
        raise HTTPException(400, "任务还在排队或执行中")
    return _task_out(tasks.retry(db, t))


@router.post("/tasks/{tid}/cancel", response_model=S.TaskOut)
def cancel_task(tid: int, db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    if t.status != "pending":
        raise HTTPException(400, "只能取消还在排队的任务")
    return _task_out(tasks.cancel(db, t))


@router.post("/tasks/cancel-pending")
def cancel_pending(project_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Task).filter(Task.status == "pending")
    if project_id:
        q = q.filter(Task.project_id == project_id)
    n = q.update({"status": "failed", "message": "已取消"})
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
        raise HTTPException(404, "日志不存在")
    return row


@router.delete("/llm-logs")
def clear_llm_logs(db: Session = Depends(get_db)):
    n = db.query(LLMLog).delete()
    db.commit()
    return {"deleted": n}
