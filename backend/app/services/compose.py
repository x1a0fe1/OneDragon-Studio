"""合成成片：逐个镜头把画面（视频或首帧）、配音、字幕、AI 标识做成统一规格的片段，再首尾拼接。

每个镜头的时长 = max(分镜里写的时长, 配音时长 + 尾部停顿)；视频不够长就定格最后一帧。
字幕和 AI 标识用 Pillow 画成透明图叠上去，不依赖 FFmpeg 的字体配置，Windows 上也稳定。
"""
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw
from sqlalchemy.orm import Session

from .. import settings_store
from ..config import MEDIA_DIR
from ..models import Episode, Task
from ..providers import ffmpeg
from ..providers.mock import font, wrap
from . import audio
from .errors import TaskAbort
from .media import new_rel_path, set_file, size_for


def render_overlay(path: Path, width: int, height: int, subtitle: str, label: str,
                   label_pos: str, size_ratio: float) -> None:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    short = min(width, height)

    if subtitle:
        f = font(max(12, int(short * size_ratio)))
        lines = wrap(d, subtitle, f, int(width * 0.86))[:3]
        line_h = int(f.size * 1.35)
        # 竖屏底部会被平台的标题、按钮挡住，字幕放在 78% 高度往上
        y = int(height * (0.78 if height > width else 0.90)) - line_h * len(lines)
        for line in lines:
            w = d.textlength(line, font=f)
            d.text(((width - w) / 2, y), line, font=f, fill=(255, 255, 255, 255),
                   stroke_width=max(2, f.size // 12), stroke_fill=(0, 0, 0, 255))
            y += line_h

    if label:
        lf = font(max(10, int(short * 0.028)))
        tw = d.textlength(label, font=lf)
        margin, px, py = int(short * 0.035), int(lf.size * 0.5), int(lf.size * 0.3)
        bw, bh = tw + px * 2, lf.size + py * 2
        x = width - margin - bw if "right" in label_pos else margin
        y = height - margin - bh if "bottom" in label_pos else margin
        d.rounded_rectangle([x, y, x + bw, y + bh], radius=bh // 2, fill=(0, 0, 0, 110))
        d.text((x + px, y + py - lf.size * 0.08), label, font=lf, fill=(255, 255, 255, 230))

    img.save(path)


def _srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def compose_episode(db: Session, task: Task) -> str:
    ep = db.get(Episode, task.target_id)
    if not ep:
        raise TaskAbort("分集已被删除")
    shots = list(ep.shots)
    if not shots:
        raise TaskAbort("这一集还没有镜头")
    missing = [f"#{s.index}" for s in shots
               if not (s.video_path and (MEDIA_DIR / s.video_path).is_file())
               and not (s.image_path and (MEDIA_DIR / s.image_path).is_file())]
    if missing:
        raise TaskAbort(f"镜头 {'、'.join(missing)} 还没有首帧或视频，先生成画面")

    project = ep.project
    tcfg = settings_store.get(db, "tts") or {}
    ccfg = settings_store.get(db, "compose") or {}

    def progress(msg: str):
        task.message = msg
        db.commit()

    # 1. 配音：缺的、台词改过的、音色改过的，重新生成
    todo = [s for s in shots if audio.needs_audio(s, project, tcfg)]
    for i, s in enumerate(todo, 1):
        progress(f"配音 {i}/{len(todo)}")
        audio.make_shot_audio(db, s)

    # 2. 逐镜头出片段
    width, height = size_for(project.aspect_ratio, int(ccfg.get("long_side") or 1280))
    fps = int(ccfg.get("fps") or 25)
    pad = float(ccfg.get("tail_padding") or 0.3)
    use_subs = bool(ccfg.get("subtitles", True))
    label = (ccfg.get("ai_label") or "").strip()
    srt, t = [], 0.0
    with tempfile.TemporaryDirectory(prefix="onedragon_") as tmp_dir:
        tmp = Path(tmp_dir)
        for i, s in enumerate(shots):
            progress(f"合成镜头 {i + 1}/{len(shots)}")
            line = audio.clean_line(s.dialogue)
            has_audio = bool(s.audio_path and (MEDIA_DIR / s.audio_path).is_file())
            length = max(float(s.duration or 1), (s.audio_duration + pad) if has_audio else 0)

            overlay = tmp / f"ov_{i:03d}.png"
            render_overlay(overlay, width, height, line if use_subs else "", label,
                           ccfg.get("ai_label_position") or "top-right", float(ccfg.get("subtitle_size") or 0.045))

            if s.video_path and (MEDIA_DIR / s.video_path).is_file():
                visual = ["-i", str(MEDIA_DIR / s.video_path)]
            else:
                visual = ["-loop", "1", "-framerate", str(fps), "-i", str(MEDIA_DIR / s.image_path)]
            sound = ["-i", str(MEDIA_DIR / s.audio_path)] if has_audio else \
                ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
            graph = (
                f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                f"fps={fps},setsar=1,tpad=stop_mode=clone:stop_duration={length:.3f},"
                f"trim=duration={length:.3f},setpts=PTS-STARTPTS[bg];"
                f"[bg][1:v]overlay=0:0,format=yuv420p[v];"
                f"[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"apad,atrim=duration={length:.3f},asetpts=PTS-STARTPTS[a]"
            )
            ffmpeg.run(*visual, "-loop", "1", "-i", str(overlay), *sound,
                       "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", f"{length:.3f}",
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(fps),
                       "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
                       str(tmp / f"seg_{i:03d}.mp4"))
            if line:
                srt.append(f"{len(srt) + 1}\n{_srt_time(t)} --> {_srt_time(t + length)}\n{line}\n")
            t += length

        # 3. 拼接
        progress("拼接成片")
        (tmp / "list.txt").write_text("".join(f"file 'seg_{i:03d}.mp4'\n" for i in range(len(shots))), encoding="utf-8")
        rel = new_rel_path(project.id, f"e{ep.id}", "final", ".mp4")
        (MEDIA_DIR / rel).parent.mkdir(parents=True, exist_ok=True)
        ffmpeg.run("-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy",
                   "-movflags", "+faststart", str(MEDIA_DIR / rel), cwd=tmp)

    srt_rel = rel[:-4] + ".srt"
    (MEDIA_DIR / srt_rel).write_text("\n".join(srt), encoding="utf-8")
    ep.final_duration = round(ffmpeg.duration(MEDIA_DIR / rel), 2)
    set_file(db, ep, "srt_path", srt_rel)
    set_file(db, ep, "final_path", rel)
    return f"成片已合成：{len(shots)} 个镜头，{ep.final_duration:.1f} 秒"
