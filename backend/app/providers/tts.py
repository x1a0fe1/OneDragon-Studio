"""配音（文字转语音）。

- edge：微软 Edge 浏览器「大声朗读」用的在线服务，免费、不用 Key、中文音色自然。非官方接口，偶尔可能不稳定。
- openai：OpenAI 兼容的 POST /v1/audio/speech，可接 OpenAI，也可接自己部署的 CosyVoice / GPT-SoVITS 等兼容服务。
- mock：按字数估一个时长，生成静音，用来不联网时跑通流程。
"""
import asyncio
import re
from pathlib import Path

import httpx

from . import ffmpeg

EDGE_VOICES = {
    "zh-CN-XiaoxiaoNeural": "晓晓（女，温柔）",
    "zh-CN-XiaoyiNeural": "晓伊（女，活泼）",
    "zh-CN-YunxiNeural": "云希（男，青年）",
    "zh-CN-YunjianNeural": "云健（男，浑厚，适合旁白）",
    "zh-CN-YunyangNeural": "云扬（男，播音腔）",
    "zh-CN-YunxiaNeural": "云夏（男孩）",
    "zh-CN-liaoning-XiaobeiNeural": "晓北（女，东北话）",
    "zh-CN-shaanxi-XiaoniNeural": "晓妮（女，陕西话）",
    "zh-TW-HsiaoChenNeural": "曉臻（女，台湾腔）",
}


class TTSError(RuntimeError):
    pass


def synthesize(cfg: dict, text: str, voice: str, out: Path) -> Path:
    """把 text 念成音频写到 out（.mp3），返回实际文件路径。"""
    provider = cfg.get("provider") or "edge"
    out.parent.mkdir(parents=True, exist_ok=True)
    speed = float(cfg.get("speed") or 1.0)
    if provider == "mock":
        seconds = max(1.0, len(text) * 0.22 / speed)
        ffmpeg.run("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{seconds:.2f}",
                    "-c:a", "libmp3lame", "-q:a", "9", str(out))
        return out
    if provider == "edge":
        return _edge(text, voice, speed, out)
    if provider == "openai":
        return _openai(cfg, text, voice, speed, out)
    raise TTSError(f"未知的配音供应商：{provider}")


def _edge(text: str, voice: str, speed: float, out: Path) -> Path:
    import edge_tts  # 用到时才导入，选别的供应商不需要它

    rate = f"{round((speed - 1) * 100):+d}%"

    async def run():
        await edge_tts.Communicate(text, voice or "zh-CN-XiaoxiaoNeural", rate=rate).save(str(out))

    try:
        asyncio.run(run())
    except Exception as e:  # noqa: BLE001  edge_tts 的异常类型很杂
        raise TTSError(f"Edge 配音失败（音色 {voice}）：{e}") from e
    if not out.exists() or out.stat().st_size < 500:
        raise TTSError(f"Edge 配音没有返回声音（音色 {voice} 可能不存在）")
    return out


def _openai(cfg: dict, text: str, voice: str, speed: float, out: Path) -> Path:
    base = (cfg.get("base_url") or "").rstrip("/")
    if not base:
        raise TTSError("没有配置配音接口地址，请到「设置」里填写")
    if base.endswith("/audio/speech"):
        url = base
    elif re.search(r"/v\d+$", base):
        url = base + "/audio/speech"
    else:
        url = base + "/v1/audio/speech"
    headers = {"Authorization": f"Bearer {cfg['api_key']}"} if cfg.get("api_key") else {}
    body = {"model": cfg.get("model") or "tts-1", "input": text, "voice": voice or "alloy",
            "response_format": "mp3", "speed": speed}
    try:
        r = httpx.post(url, headers=headers, json=body, timeout=120)
    except httpx.HTTPError as e:
        raise TTSError(f"请求配音接口失败：{e}") from e
    if r.status_code != 200:
        raise TTSError(f"配音接口返回 {r.status_code}：{r.text[:300]}")
    out.write_bytes(r.content)
    return out
