"""云端生图 / 生视频：阿里云百炼（通义万相）和火山方舟（豆包 Seedream / Seedance）。

不用 GPU、不用装 ComfyUI，填 API Key 就能出真画面，按张 / 按秒计费。
- 图片：同步接口直接返回链接；带参考图时用支持多图输入的模型
- 视频：异步任务，提交后轮询，拿到链接立刻下载（平台只保留 24 小时）

接口格式依据（2026-11 查阅的官方文档）：
- 百炼 文生图 wan2.6-t2i / 图像编辑 wan2.6-image：POST /api/v1/services/aigc/multimodal-generation/generation
- 百炼 图生视频 wan2.6-i2v-flash：POST /api/v1/services/aigc/video-generation/video-synthesis + X-DashScope-Async
- 方舟 图片 Seedream：POST /api/v3/images/generations
- 方舟 视频 Seedance：POST /api/v3/contents/generations/tasks，GET .../tasks/{id}
"""
import base64
import io
import math
import random
import time
from pathlib import Path
from typing import Callable

import httpx
from PIL import Image

from ..i18n import _

Progress = Callable[[str], None]


class CloudError(RuntimeError):
    """临时性错误（网络、限流、服务端 5xx），可以重试。"""


class CloudAbort(RuntimeError):
    """配置或内容错误（Key 无效、参数不对、内容审核不通过），重试也没用。"""


PROVIDERS = {"aliyun": "阿里云百炼", "volcengine": "火山方舟"}


def provider_name(key: str) -> str:
    """供应商的显示名（按当前界面语言）。"""
    if key == "aliyun":
        return _("阿里云百炼", "Alibaba Cloud Model Studio")
    if key == "volcengine":
        return _("火山方舟", "Volcano Engine Ark")
    return PROVIDERS.get(key, key)


# ---------- 公共 ----------
def _key(cfg: dict, name: str) -> str:
    key = (cfg.get("api_key") or "").strip()
    if not key:
        raise CloudAbort(_(f"还没有填 {name} 的 API Key，到「系统设置」里填写", f"No API key set for {name}. Fill it in under Settings"))
    return key


def _check(r: httpx.Response, name: str) -> dict:
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code == 200:
        return data
    msg = _error_text(data) or r.text[:300]
    if any(k in msg.lower() for k in ("arrearage", "overdue", "insufficient balance", "insufficientbalance")):
        raise CloudAbort(_(f"{name} 账户欠费或余额不足，请到控制台充值后再试（{r.status_code}）：{msg}",
                           f"{name} account is overdue or out of balance; top up in the console and retry ({r.status_code}): {msg}"))
    if r.status_code in (401, 403):
        raise CloudAbort(_(f"{name} 拒绝访问（{r.status_code}）：API Key 无效、没开通这个模型或余额不足。{msg}", f"{name} denied access ({r.status_code}): invalid API key, model not enabled, or insufficient balance. {msg}"))
    if r.status_code == 429 or r.status_code >= 500:
        raise CloudError(_(f"{name} 暂时繁忙（{r.status_code}）：{msg}", f"{name} is temporarily busy ({r.status_code}): {msg}"))
    raise CloudAbort(_(f"{name} 返回 {r.status_code}：{_hint(msg)}", f"{name} returned {r.status_code}: {_hint(msg)}"))


def _error_text(data: dict) -> str:
    if not isinstance(data, dict):
        return ""
    err = data.get("error")
    if isinstance(err, dict):
        return f"{err.get('code', '')} {err.get('message', '')}".strip()
    out = data.get("output") if isinstance(data.get("output"), dict) else data
    return f"{out.get('code', '') or data.get('code', '')} {out.get('message', '') or data.get('message', '')}".strip()


def _hint(msg: str) -> str:
    low = msg.lower()
    if any(k in low for k in ("arrearage", "overdue", "insufficient balance", "insufficientbalance", "余额不足", "欠费")):
        return msg + _("（账户欠费或余额不足：到平台控制台充值后再试）", " (account overdue or insufficient balance: top up in the platform console, then retry)")
    if any(k in low for k in ("datainspection", "sensitive", "inappropriate", "risk", "审核")):
        return msg + _("（内容审核没通过：换个说法，避开暴力、血腥、真实人物等描写再试）", " (failed content moderation: rephrase and avoid violence, gore, real people, etc., then retry)")
    if "ipinfringement" in low:
        return msg + _("（疑似侵权：提示词里不要出现真实明星、品牌、已有动漫角色）", " (possible infringement: keep real celebrities, brands and existing anime characters out of the prompt)")
    if "model" in low and ("not" in low or "exist" in low or "access" in low):
        return msg + _("（模型名可能写错了，或者账号还没开通这个模型）", " (the model name may be wrong, or this model is not enabled on your account)")
    return msg


def data_uri(path: Path, max_bytes: int = 7 * 1024 * 1024) -> str:
    """本地图片转成 data URI；太大就转成 JPEG 压一下，平台单张上限一般是 10～30MB。"""
    raw = path.read_bytes()
    mime = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp"}.get(path.suffix.lower(), "png")
    if len(raw) > max_bytes or mime == "png" and _has_alpha(raw):
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        img.thumbnail((2048, 2048))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        raw, mime = buf.getvalue(), "jpeg"
    return f"data:image/{mime};base64,{base64.b64encode(raw).decode()}"


def _has_alpha(raw: bytes) -> bool:
    try:
        return Image.open(io.BytesIO(raw)).mode in ("RGBA", "LA", "P")
    except OSError:
        return False


def fit_size(width: int, height: int, min_area: int, max_area: int, target_area: int, sep: str) -> str:
    """按画面比例算一个平台接受的尺寸（宽高都取 16 的倍数，总像素落在范围内）。"""
    ratio = width / height
    area = max(min_area, min(max_area, target_area))
    w = math.sqrt(area * ratio)
    h = w / ratio
    w, h = int(round(w / 16)) * 16, int(round(h / 16)) * 16
    while w * h > max_area:
        w, h = w - 16, int(round((w - 16) / ratio / 16)) * 16
    while w * h < min_area:
        w, h = w + 16, int(round((w + 16) / ratio / 16)) * 16
    return f"{w}{sep}{h}"


def download(url: str, out: Path, timeout: float = 300) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as r:
            if r.status_code != 200:
                raise CloudError(_(f"下载结果失败（{r.status_code}）", f"Failed to download result ({r.status_code})"))
            with open(out, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    except httpx.HTTPError as e:
        raise CloudError(_(f"下载结果失败：{e}", f"Failed to download result: {e}")) from e
    return out


def _post(url: str, key: str, body: dict, name: str, headers: dict | None = None, timeout: float = 300) -> dict:
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", **(headers or {})}
    try:
        r = httpx.post(url, headers=h, json=body, timeout=timeout)
    except httpx.HTTPError as e:
        raise CloudError(_(f"连接 {name} 失败：{e}", f"Failed to connect to {name}: {e}")) from e
    return _check(r, name)


def _get(url: str, key: str, name: str) -> dict:
    try:
        r = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=60)
    except httpx.HTTPError as e:
        raise CloudError(_(f"连接 {name} 失败：{e}", f"Failed to connect to {name}: {e}")) from e
    return _check(r, name)


def _poll(fetch: Callable[[], tuple[str, dict]], progress: Progress | None, timeout: float, name: str,
          interval: float = 8) -> dict:
    """fetch 返回 (状态, 原始数据)；状态归一成 pending / running / succeeded / failed。"""
    start = time.monotonic()
    last = ""
    while True:
        state, data = fetch()
        if state == "succeeded":
            return data
        if state == "failed":
            raise CloudAbort(_(f"{name} 生成失败：{_hint(_error_text(data) or '没有返回原因')}",
                                f"{name} generation failed: {_hint(_error_text(data) or 'no reason given')}"))
        elapsed = int(time.monotonic() - start)
        msg = _(f"{name} {'排队中' if state == 'pending' else '生成中'}… 已等 {elapsed} 秒",
                f"{name} {'queued' if state == 'pending' else 'generating'}… waited {elapsed}s")
        if progress and msg != last:
            progress(msg)
            last = msg
        if elapsed > timeout:
            raise CloudError(_(f"{name} 超过 {int(timeout)} 秒还没出结果", f"{name} produced no result after {int(timeout)}s"))
        time.sleep(interval)


# ---------- 阿里云百炼 ----------
def _ali_base(cfg: dict) -> str:
    return (cfg.get("base_url") or "https://dashscope.aliyuncs.com").rstrip("/")


def _ali_image_url(data: dict) -> str:
    for choice in (data.get("output") or {}).get("choices") or []:
        for item in (choice.get("message") or {}).get("content") or []:
            if isinstance(item, dict) and item.get("image"):
                return item["image"]
    raise CloudAbort(_("阿里云百炼没有返回图片：", "Alibaba Cloud Model Studio returned no image: ") + (_error_text(data) or str(data)[:200]))


def aliyun_image(cfg: dict, prompt: str, negative: str, width: int, height: int,
                 refs: list[Path], out: Path) -> Path:
    name = provider_name("aliyun")
    key = _key(cfg, name)
    use_refs = bool(refs) and cfg.get("use_refs", True)
    content = [{"text": prompt[:2000]}] + [{"image": data_uri(p)} for p in (refs[:4] if use_refs else [])]
    if use_refs:
        model = cfg.get("ref_image_model") or "wan2.6-image"
        size = fit_size(width, height, 768 * 768, 2048 * 2048, 1440 * 1440, "*")
        params = {"n": 1, "size": size, "enable_interleave": False, "prompt_extend": True, "watermark": False}
    else:
        model = cfg.get("image_model") or "wan2.6-t2i"
        size = fit_size(width, height, 1280 * 1280, 1440 * 1440, 1360 * 1360, "*")
        params = {"n": 1, "size": size, "prompt_extend": True, "watermark": False}
    if negative:
        params["negative_prompt"] = negative[:500]
    params["seed"] = random.randint(0, 2**31 - 1)
    data = _post(f"{_ali_base(cfg)}/api/v1/services/aigc/multimodal-generation/generation", key,
                 {"model": model, "input": {"messages": [{"role": "user", "content": content}]}, "parameters": params},
                 name)
    return download(_ali_image_url(data), out)


def aliyun_video(cfg: dict, prompt: str, negative: str, first_frame: Path, seconds: float,
                 out: Path, progress: Progress | None = None, timeout: float = 1800) -> Path:
    name = provider_name("aliyun")
    key = _key(cfg, name)
    model = cfg.get("video_model") or "wan2.6-i2v-flash"
    lo, hi = int(cfg.get("video_min_seconds") or 2), int(cfg.get("video_max_seconds") or 15)
    params = {"resolution": cfg.get("video_resolution") or "720P", "duration": max(lo, min(hi, math.ceil(seconds))),
              "prompt_extend": True, "watermark": False}
    if model.startswith("wan2.6-i2v-flash"):
        params["audio"] = False  # 配音由我们自己做；这个模型默认会配音，要显式关掉
    body = {"model": model, "input": {"prompt": prompt[:1500], "img_url": data_uri(first_frame)}, "parameters": params}
    if negative:
        body["input"]["negative_prompt"] = negative[:500]
    base = _ali_base(cfg)
    task_id = (_post(f"{base}/api/v1/services/aigc/video-generation/video-synthesis", key, body, name,
                     headers={"X-DashScope-Async": "enable"}).get("output") or {}).get("task_id")
    if not task_id:
        raise CloudAbort(_("阿里云百炼没有返回任务号", "Alibaba Cloud Model Studio returned no task ID"))

    def fetch():
        data = _get(f"{base}/api/v1/tasks/{task_id}", key, name)
        st = ((data.get("output") or {}).get("task_status") or "").upper()
        state = {"SUCCEEDED": "succeeded", "FAILED": "failed", "CANCELED": "failed", "UNKNOWN": "failed",
                 "RUNNING": "running"}.get(st, "pending")
        return state, data

    data = _poll(fetch, progress, timeout, name, interval=10)
    url = (data.get("output") or {}).get("video_url")
    if not url:
        raise CloudAbort(_("阿里云百炼任务成功了，但没有返回视频链接", "Alibaba Cloud Model Studio task succeeded but returned no video URL"))
    return download(url, out)


# ---------- 火山方舟 ----------
def _volc_base(cfg: dict) -> str:
    return (cfg.get("base_url") or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")


def volcengine_image(cfg: dict, prompt: str, negative: str, width: int, height: int,
                     refs: list[Path], out: Path) -> Path:
    name = provider_name("volcengine")
    key = _key(cfg, name)
    body = {
        "model": cfg.get("image_model") or "doubao-seedream-5-0-pro-260628",
        # Seedream 没有反向提示词参数，把要避免的内容写进正向提示词
        "prompt": (prompt + (f"。画面中不要出现：{negative}" if negative else ""))[:600],
        "size": fit_size(width, height, 3686400, 4624220, 2048 * 2048, "x"),
        "sequential_image_generation": "disabled",
        "response_format": "url",
        "watermark": False,
    }
    if refs and cfg.get("use_refs", True):
        body["image"] = [data_uri(p) for p in refs[:4]]
    data = _post(f"{_volc_base(cfg)}/images/generations", key, body, name)
    items = data.get("data") or []
    url = items[0].get("url") if items and isinstance(items[0], dict) else None
    if not url:
        raise CloudAbort(_("火山方舟没有返回图片：", "Volcano Engine Ark returned no image: ") + (_error_text(data) or str(data)[:200]))
    return download(url, out)


def volcengine_video(cfg: dict, prompt: str, negative: str, first_frame: Path, seconds: float,
                     out: Path, progress: Progress | None = None, timeout: float = 1800, ratio: str = "adaptive") -> Path:
    name = provider_name("volcengine")
    key = _key(cfg, name)
    lo, hi = int(cfg.get("video_min_seconds") or 4), int(cfg.get("video_max_seconds") or 30)
    text = prompt + (f"。避免：{negative}" if negative else "")
    body = {
        "model": cfg.get("video_model") or "doubao-seedance-2-5-260628",
        "content": [
            {"type": "text", "text": text[:1500]},
            {"type": "image_url", "image_url": {"url": data_uri(first_frame)}, "role": "first_frame"},
        ],
        "ratio": ratio,
        "duration": max(lo, min(hi, math.ceil(seconds))),
        "resolution": cfg.get("video_resolution") or "720p",
        "generate_audio": False,  # 配音由我们自己做
        "watermark": False,
    }
    base = _volc_base(cfg)
    task_id = _post(f"{base}/contents/generations/tasks", key, body, name).get("id")
    if not task_id:
        raise CloudAbort(_("火山方舟没有返回任务号", "Volcano Engine Ark returned no task ID"))

    def fetch():
        data = _get(f"{base}/contents/generations/tasks/{task_id}", key, name)
        st = (data.get("status") or "").lower()
        state = {"succeeded": "succeeded", "failed": "failed", "expired": "failed", "cancelled": "failed",
                 "running": "running"}.get(st, "pending")
        return state, data

    data = _poll(fetch, progress, timeout, name, interval=8)
    url = (data.get("content") or {}).get("video_url")
    if not url:
        raise CloudAbort(_("火山方舟任务成功了，但没有返回视频链接", "Volcano Engine Ark task succeeded but returned no video URL"))
    return download(url, out)


# ---------- 统一入口 ----------
def image(provider: str, cfg: dict, **kw) -> Path:
    return {"aliyun": aliyun_image, "volcengine": volcengine_image}[provider](cfg, **kw)


def video(provider: str, cfg: dict, **kw) -> Path:
    return {"aliyun": aliyun_video, "volcengine": volcengine_video}[provider](cfg, **kw)


def test(provider: str, cfg: dict) -> str:
    """只验证地址和 Key，不生成内容、不花钱：查一个不存在的任务，Key 对的话会返回「任务不存在」之类。"""
    name = provider_name(provider)
    key = _key(cfg, name)
    url = (f"{_ali_base(cfg)}/api/v1/tasks/onedragon-connection-test" if provider == "aliyun"
           else f"{_volc_base(cfg)}/contents/generations/tasks/onedragon-connection-test")
    try:
        r = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=20)
    except httpx.HTTPError as e:
        raise CloudError(_(f"连接 {name} 失败：{e}", f"Failed to connect to {name}: {e}")) from e
    if r.status_code in (401, 403):
        try:
            detail = _error_text(r.json())
        except ValueError:
            detail = ""
        raise CloudAbort(_(f"{name} 拒绝访问（{r.status_code}）：API Key 无效。{detail}", f"{name} denied access ({r.status_code}): invalid API key. {detail}"))
    if r.status_code >= 500:
        raise CloudError(_(f"{name} 服务暂时不可用（{r.status_code}）", f"{name} service temporarily unavailable ({r.status_code})"))
    return _(f"{name} 连接正常，API Key 有效", f"{name} connection OK, API key is valid")
