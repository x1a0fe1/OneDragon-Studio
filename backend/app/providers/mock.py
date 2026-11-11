"""演示供应商：不调用任何模型。生成带文字的占位图、缓慢推近的占位视频，没有 GPU 时也能把整条流水线跑通。"""
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from . import ffmpeg

_FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]


def font(size: int):
    for f in _FONT_CANDIDATES:
        if Path(f).exists():
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


_NO_LINE_START = set("，。、；：？！…）》」』”’,.;:?!)")


def wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    """按字符折行（中文没有空格可断）；标点不放到行首。"""
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
        elif draw.textlength(cur + ch, font=font) > width and ch not in _NO_LINE_START:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def image(out: Path, title: str, prompt: str, width: int, height: int) -> Path:
    h = hashlib.md5(title.encode("utf-8")).digest()
    top = (50 + h[0] % 90, 30 + h[1] % 70, 40 + h[2] % 90)
    bottom = tuple(c // 4 for c in top)
    img = Image.new("RGB", (width, height))
    d = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height - 1)
        d.line([(0, y), (width, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))

    short = min(width, height)
    pad = short // 12
    title_font, body_font, foot_font = font(short // 11), font(short // 26), font(short // 34)
    y = height // 8
    for line in wrap(d, title, title_font, width - 2 * pad)[:2]:
        d.text((pad, y), line, font=title_font, fill=(255, 236, 190))
        y += int(title_font.size * 1.3)
    y += body_font.size
    line_h = int(body_font.size * 1.55)
    max_lines = max(1, (height - pad * 3 - y) // line_h)
    lines = wrap(d, prompt, body_font, width - 2 * pad)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-1] + "…"
    for line in lines:
        d.text((pad, y), line, font=body_font, fill=(236, 236, 236))
        y += line_h
    d.text((pad, height - pad - foot_font.size), "演示占位图 · 换成 ComfyUI 后这里是真实画面",
           font=foot_font, fill=(255, 255, 255))

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out


def video(out: Path, image_path: Path, seconds: float, width: int, height: int, fps: int = 25) -> Path:
    """把首帧图做成缓慢推近的视频。"""
    width, height = width // 2 * 2, height // 2 * 2
    frames = max(1, round(seconds * fps))
    vf = (f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,crop={width * 2}:{height * 2},"
          f"zoompan=z='min(zoom+0.0012,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
          f":d={frames}:s={width}x{height}:fps={fps},format=yuv420p")
    out.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg.run("-loop", "1", "-i", str(image_path), "-vf", vf, "-frames:v", str(frames),
           "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", "-an", str(out))
    return out
