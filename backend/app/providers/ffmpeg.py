"""调用 FFmpeg（用 imageio-ffmpeg 自带的可执行文件，不需要单独安装）。"""
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

from ..i18n import _

EXE = imageio_ffmpeg.get_ffmpeg_exe()
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run(*args: str, timeout: int = 900, cwd: Path | None = None) -> None:
    cmd = [EXE, "-y", "-hide_banner", "-loglevel", "error", *args]
    r = subprocess.run(cmd, capture_output=True, timeout=timeout, cwd=cwd, creationflags=_NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError(_("FFmpeg 出错：", "FFmpeg error: ") + r.stderr.decode("utf-8", "replace")[-800:])


def duration(path: Path) -> float:
    """读媒体文件时长（秒）。"""
    r = subprocess.run([EXE, "-hide_banner", "-i", str(path)], capture_output=True, timeout=60,
                       creationflags=_NO_WINDOW)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr.decode("utf-8", "replace"))
    if not m:
        raise RuntimeError(_(f"读不出时长：{path.name}", f"Cannot read duration: {path.name}"))
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)
