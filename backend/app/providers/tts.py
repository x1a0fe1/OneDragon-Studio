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
from ..i18n import _

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


EDGE_VOICES_EN = {
    "zh-CN-XiaoxiaoNeural": "Xiaoxiao (female, gentle)",
    "zh-CN-XiaoyiNeural": "Xiaoyi (female, lively)",
    "zh-CN-YunxiNeural": "Yunxi (male, young)",
    "zh-CN-YunjianNeural": "Yunjian (male, deep, good for narration)",
    "zh-CN-YunyangNeural": "Yunyang (male, broadcaster)",
    "zh-CN-YunxiaNeural": "Yunxia (boy)",
    "zh-CN-liaoning-XiaobeiNeural": "Xiaobei (female, Northeastern dialect)",
    "zh-CN-shaanxi-XiaoniNeural": "Xiaoni (female, Shaanxi dialect)",
    "zh-TW-HsiaoChenNeural": "HsiaoChen (female, Taiwanese accent)",
}


def edge_voices() -> dict:
    """EDGE_VOICES 的按当前界面语言翻译的版本，给下拉框用。"""
    return {k: _(v, EDGE_VOICES_EN.get(k, v)) for k, v in EDGE_VOICES.items()}


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
    raise TTSError(_(f"未知的配音供应商：{provider}", f"Unknown voice-over provider: {provider}"))


def _edge(text: str, voice: str, speed: float, out: Path) -> Path:
    import edge_tts  # 用到时才导入，选别的供应商不需要它

    rate = f"{round((speed - 1) * 100):+d}%"

    async def run():
        await edge_tts.Communicate(text, voice or "zh-CN-XiaoxiaoNeural", rate=rate).save(str(out))

    try:
        asyncio.run(run())
    except Exception as e:  # noqa: BLE001  edge_tts 的异常类型很杂
        raise TTSError(_(f"Edge 配音失败（音色 {voice}）：{e}", f"Edge voice-over failed (voice {voice}): {e}")) from e
    if not out.exists() or out.stat().st_size < 500:
        raise TTSError(_(f"Edge 配音没有返回声音（音色 {voice} 可能不存在）", f"Edge voice-over returned no audio (voice {voice} may not exist)"))
    return out


def _openai(cfg: dict, text: str, voice: str, speed: float, out: Path) -> Path:
    base = (cfg.get("base_url") or "").rstrip("/")
    if not base:
        raise TTSError(_("没有配置配音接口地址，请到「设置」里填写", "No voice-over endpoint URL configured. Fill it in under Settings"))
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
        raise TTSError(_(f"请求配音接口失败：{e}", f"Voice-over request failed: {e}")) from e
    if r.status_code != 200:
        raise TTSError(_(f"配音接口返回 {r.status_code}：{r.text[:300]}", f"Voice-over endpoint returned {r.status_code}: {r.text[:300]}"))
    out.write_bytes(r.content)
    return out
