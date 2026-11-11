"""生图 / 生视频：角色参考图、场景参考图、镜头首帧、镜头视频。按设置选择供应商（演示 / ComfyUI）。

生成的文件放在 MEDIA_DIR/p{项目}/ 下，数据库里只存相对路径。
"""
import shutil
import tempfile
import time
from pathlib import Path

from sqlalchemy.orm import Session

from .. import prompts, settings_store
from ..config import MEDIA_DIR
from ..models import Character, Project, Prop, Scene, Shot, Task
from ..providers import cloud, comfyui, ffmpeg, mock
from .errors import TaskAbort


# ---------- 提示词 ----------
def character_prompt(db: Session, c: Character, style: str) -> str:
    if c.image_prompt.strip():
        return c.image_prompt.strip()
    return prompts.render(prompts.get(db, "character_image"), name=c.name, appearance=c.appearance, style=style)


def scene_prompt(db: Session, s: Scene, style: str) -> str:
    if s.image_prompt.strip():
        return s.image_prompt.strip()
    return prompts.render(prompts.get(db, "scene_image"), name=s.name, description=s.description, style=style)


def prop_prompt(db: Session, p: Prop, style: str) -> str:
    if p.image_prompt.strip():
        return p.image_prompt.strip()
    return prompts.render(prompts.get(db, "prop_image"), name=p.name, description=p.description, style=style)


def shot_prompt(s: Shot, project: Project) -> str:
    parts = [s.image_prompt.strip() or s.visual.strip()]
    chars = {c.name: c for c in project.characters}
    looks = [f"{n}：{chars[n].appearance}" for n in s.character_names if n in chars and chars[n].appearance]
    if looks:
        parts.append("人物外貌——" + "；".join(looks))
    props = {p.name: p for p in project.props}
    items = [f"{n}：{props[n].description}" for n in (s.prop_names or []) if n in props and props[n].description]
    if items:
        parts.append("道具——" + "；".join(items))
    if project.style and project.style not in parts[0]:
        parts.append(project.style)
    return "，".join(p for p in parts if p)


def shot_refs(s: Shot, project: Project) -> list[str]:
    """镜头首帧可用的参考图：出镜角色最优先，其次道具，最后场景（工作流最多用 3 张）。"""
    chars = {c.name: c for c in project.characters}
    refs = [chars[n].ref_image for n in s.character_names if n in chars and chars[n].ref_image]
    props = {p.name: p for p in project.props}
    refs += [props[n].ref_image for n in (s.prop_names or []) if n in props and props[n].ref_image]
    scene = next((x for x in project.scenes if x.name == s.scene_name), None)
    if scene and scene.ref_image:
        refs.append(scene.ref_image)
    return refs


# ---------- 尺寸 / 文件 ----------
def size_for(aspect: str, long_side: int) -> tuple[int, int]:
    try:
        a, b = (float(x) for x in aspect.split(":"))
    except ValueError:
        a, b = 9.0, 16.0
    long_side = int(long_side)
    if a >= b:
        w, h = long_side, long_side * b / a
    else:
        w, h = long_side * a / b, long_side
    return int(round(w / 16)) * 16, int(round(h / 16)) * 16


def frames_for(seconds: float, fps: int) -> int:
    return max(5, round(seconds * fps / 4) * 4 + 1)


def new_rel_path(project_id: int, folder: str, stem: str, suffix: str) -> str:
    return f"p{project_id}/{folder}/{stem}_{int(time.time() * 1000)}{suffix}"


def set_file(db: Session, obj, field: str, rel: str) -> None:
    """换上新文件并删掉旧文件。"""
    old = getattr(obj, field)
    setattr(obj, field, rel)
    db.commit()
    if old and old != rel:
        remove_file(old)


def remove_file(rel: str) -> None:
    p = (MEDIA_DIR / rel).resolve()
    if MEDIA_DIR.resolve() in p.parents and p.is_file():
        p.unlink(missing_ok=True)


def remove_dir(rel: str) -> None:
    p = (MEDIA_DIR / rel).resolve()
    if MEDIA_DIR.resolve() in p.parents:
        shutil.rmtree(p, ignore_errors=True)


def _progress(db: Session, task: Task):
    def report(msg: str):
        task.message = msg
        db.commit()
    return report


def _normalize_image(out: Path, rel: str) -> str:
    """云端返回的可能是 JPEG/WEBP，按真实格式改后缀，免得浏览器和 FFmpeg 认错。"""
    from PIL import Image
    try:
        fmt = (Image.open(out).format or "PNG").lower()
    except OSError as e:
        out.unlink(missing_ok=True)
        raise TaskAbort("下载回来的不是图片") from e
    suffix = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}.get(fmt, ".png")
    if suffix != out.suffix:
        new_rel = rel[: -len(out.suffix)] + suffix
        out.rename(MEDIA_DIR / new_rel)
        return new_rel
    return rel


# ---------- 生成 ----------
def _make_image(db: Session, task: Task, *, project: Project, title: str, prompt: str,
                aspect: str, rel_stem: tuple[str, str], refs: list[str] | None = None) -> str:
    provider = settings_store.get(db, "image_provider")
    cfg = settings_store.get(db, "comfyui") or {}
    width, height = size_for(aspect, cfg.get("image_long_side") or 1280)
    folder, stem = rel_stem

    if provider == "mock":
        rel = new_rel_path(project.id, folder, stem, ".png")
        mock.image(MEDIA_DIR / rel, title, prompt, width, height)
        return rel

    refs = [r for r in (refs or []) if (MEDIA_DIR / r).is_file()]
    if provider in cloud.PROVIDERS:
        task.message = f"{cloud.PROVIDERS[provider]} 生成中…"
        db.commit()
        rel = new_rel_path(project.id, folder, stem, ".png")
        try:
            out = cloud.image(provider, settings_store.get(db, provider) or {}, prompt=prompt,
                              negative=cfg.get("negative_prompt", ""), width=width, height=height,
                              refs=[MEDIA_DIR / r for r in refs], out=MEDIA_DIR / rel)
        except cloud.CloudAbort as e:
            raise TaskAbort(str(e)) from e
        return _normalize_image(out, rel)

    if provider != "comfyui":
        raise TaskAbort(f"未知的生图供应商：{provider}")
    use_ref = bool(refs and (cfg.get("ref_image_workflow") or "").strip())
    text = cfg.get("ref_image_workflow") if use_ref else cfg.get("image_workflow")
    if not (text or "").strip():
        raise TaskAbort("还没有配置 ComfyUI 生图工作流：到「设置」里粘贴 API 格式的工作流 JSON")
    try:
        wf = comfyui.parse_workflow(text)
        with comfyui.Client(cfg) as client:
            values = {
                "prompt": prompt,
                "negative": cfg.get("negative_prompt", ""),
                "seed": comfyui.new_seed(),
                "width": width,
                "height": height,
                "filename_prefix": f"onedragon/{stem}",
            }
            if use_ref:
                uploaded = [client.upload(MEDIA_DIR / r) for r in refs[:3]]
                for i in range(3):
                    values[f"ref_image_{i + 1}"] = uploaded[min(i, len(uploaded) - 1)]
            outputs = client.run(comfyui.fill(wf, values), _progress(db, task))
            files = comfyui.output_files(outputs, comfyui.IMAGE_EXTS)
            if not files:
                raise comfyui.WorkflowError("工作流跑完了，但没有输出图片。检查是不是缺了「保存图像」节点")
            rel = new_rel_path(project.id, folder, stem, Path(files[0]["filename"]).suffix.lower())
            client.download(files[0], MEDIA_DIR / rel)
            return rel
    except comfyui.WorkflowError as e:
        raise TaskAbort(str(e)) from e


def _make_video(db: Session, task: Task, *, shot: Shot, project: Project) -> str:
    provider = settings_store.get(db, "video_provider")
    cfg = settings_store.get(db, "comfyui") or {}
    width, height = size_for(project.aspect_ratio, cfg.get("video_long_side") or 832)
    first_frame = MEDIA_DIR / shot.image_path
    stem = f"shot{shot.id}_video"
    folder = f"e{shot.episode_id}"
    rel = new_rel_path(project.id, folder, stem, ".mp4")

    if provider == "mock":
        mock.video(MEDIA_DIR / rel, first_frame, shot.duration, width, height)
        return rel

    if provider in cloud.PROVIDERS:
        kw = {"ratio": "adaptive"} if provider == "volcengine" else {}
        try:
            cloud.video(provider, settings_store.get(db, provider) or {},
                        prompt=shot.video_prompt.strip() or shot.visual.strip() or shot.image_prompt.strip(),
                        negative=cfg.get("negative_prompt", ""), first_frame=first_frame, seconds=shot.duration,
                        out=MEDIA_DIR / rel, progress=_progress(db, task),
                        timeout=float(cfg.get("timeout_sec") or 1800), **kw)
        except cloud.CloudAbort as e:
            raise TaskAbort(str(e)) from e
        return rel

    if provider != "comfyui":
        raise TaskAbort(f"未知的生视频供应商：{provider}")
    text = cfg.get("video_workflow") or ""
    if not text.strip():
        raise TaskAbort("还没有配置 ComfyUI 图生视频工作流：到「设置」里粘贴 API 格式的工作流 JSON")
    fps = int(cfg.get("fps") or 16)
    try:
        wf = comfyui.parse_workflow(text)
        with comfyui.Client(cfg) as client:
            values = {
                "prompt": shot.video_prompt.strip() or shot.visual.strip() or shot.image_prompt.strip(),
                "negative": cfg.get("negative_prompt", ""),
                "seed": comfyui.new_seed(),
                "width": width,
                "height": height,
                "image": client.upload(first_frame),
                "frames": frames_for(shot.duration, fps),
                "fps": fps,
                "duration": shot.duration,
                "filename_prefix": f"onedragon/{stem}",
            }
            outputs = client.run(comfyui.fill(wf, values), _progress(db, task))
            files = comfyui.output_files(outputs, comfyui.VIDEO_EXTS)
            if not files:
                raise comfyui.WorkflowError("工作流跑完了，但没有输出视频。请用能保存 mp4 的节点（如 Video Combine / 保存视频）")
            f = files[0]
            if Path(f["filename"]).suffix.lower() == ".mp4":
                client.download(f, MEDIA_DIR / rel)
            else:  # gif / webm 等统一转成 mp4，后面合成更省事
                with tempfile.TemporaryDirectory() as tmp:
                    src = client.download(f, Path(tmp) / Path(f["filename"]).name)
                    (MEDIA_DIR / rel).parent.mkdir(parents=True, exist_ok=True)
                    ffmpeg.run("-i", str(src), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-an", str(MEDIA_DIR / rel))
            return rel
    except comfyui.WorkflowError as e:
        raise TaskAbort(str(e)) from e


# ---------- 任务处理函数 ----------
def character_image(db: Session, task: Task) -> str:
    c = db.get(Character, task.target_id)
    if not c:
        raise TaskAbort("角色已被删除")
    p = c.project
    rel = _make_image(db, task, project=p, title=f"角色 · {c.name}", prompt=character_prompt(db, c, p.style),
                      aspect="16:9", rel_stem=("assets", f"char{c.id}"))
    set_file(db, c, "ref_image", rel)
    return f"「{c.name}」参考图已生成"


def scene_image(db: Session, task: Task) -> str:
    s = db.get(Scene, task.target_id)
    if not s:
        raise TaskAbort("场景已被删除")
    p = s.project
    rel = _make_image(db, task, project=p, title=f"场景 · {s.name}", prompt=scene_prompt(db, s, p.style),
                      aspect=p.aspect_ratio, rel_stem=("assets", f"scene{s.id}"))
    set_file(db, s, "ref_image", rel)
    return f"「{s.name}」参考图已生成"


def prop_image(db: Session, task: Task) -> str:
    pr = db.get(Prop, task.target_id)
    if not pr:
        raise TaskAbort("道具已被删除")
    p = pr.project
    rel = _make_image(db, task, project=p, title=f"道具 · {pr.name}", prompt=prop_prompt(db, pr, p.style),
                      aspect="1:1", rel_stem=("assets", f"prop{pr.id}"))
    set_file(db, pr, "ref_image", rel)
    return f"「{pr.name}」参考图已生成"


def shot_image(db: Session, task: Task) -> str:
    s = db.get(Shot, task.target_id)
    if not s:
        raise TaskAbort("镜头已被删除")
    p = s.episode.project
    rel = _make_image(db, task, project=p, title=f"第{s.episode.index}集 · 镜头 #{s.index}",
                      prompt=shot_prompt(s, p), aspect=p.aspect_ratio,
                      rel_stem=(f"e{s.episode_id}", f"shot{s.id}_frame"), refs=shot_refs(s, p))
    set_file(db, s, "image_path", rel)
    return f"镜头 #{s.index} 首帧已生成"


def shot_video(db: Session, task: Task) -> str:
    s = db.get(Shot, task.target_id)
    if not s:
        raise TaskAbort("镜头已被删除")
    if not s.image_path or not (MEDIA_DIR / s.image_path).is_file():
        raise TaskAbort(f"镜头 #{s.index} 还没有首帧图，先生成首帧")
    rel = _make_video(db, task, shot=s, project=s.episode.project)
    set_file(db, s, "video_path", rel)
    return f"镜头 #{s.index} 视频已生成（{s.duration:g} 秒）"
