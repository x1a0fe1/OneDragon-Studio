"""调用大模型并记日志。业务代码统一走这里，「AI 日志」页才能看到每一次请求和返回。"""
import logging
import time

from .. import settings_store
from ..db import SessionLocal
from ..models import LLMLog
from ..providers import llm

log = logging.getLogger("onedragon.ai")
KEEP_LOGS = 500  # 只保留最近这么多条


def chat(messages: list[dict], *, purpose: str, project_id: int = 0, target: str = "",
         json_mode: bool = False, timeout: float = 600, cfg: dict | None = None) -> str:
    if cfg is None:
        with SessionLocal() as db:
            cfg = settings_store.get(db, "llm") or {}
    started = time.monotonic()
    entry = LLMLog(purpose=purpose, project_id=project_id, target=target,
                   model=cfg.get("model", ""), base_url=cfg.get("base_url", ""), messages=messages)
    try:
        result = llm.complete(cfg, messages, json_mode=json_mode, timeout=timeout)
        entry.response = result["content"]
        entry.prompt_tokens = result["usage"]["prompt_tokens"]
        entry.completion_tokens = result["usage"]["completion_tokens"]
        return result["content"]
    except Exception as e:
        entry.status, entry.error = "error", str(e)
        raise
    finally:
        entry.duration_ms = int((time.monotonic() - started) * 1000)
        _save(entry)


def _save(entry: LLMLog) -> None:
    """日志单独开一个会话写，失败也不影响业务。"""
    try:
        with SessionLocal() as db:
            db.add(entry)
            db.commit()
            if entry.id and entry.id % 50 == 0:
                cutoff = entry.id - KEEP_LOGS
                db.query(LLMLog).filter(LLMLog.id <= cutoff).delete()
                db.commit()
    except Exception:  # noqa: BLE001
        log.exception("写 AI 日志失败")
