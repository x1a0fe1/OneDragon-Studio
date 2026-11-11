"""AI 拆分镜：把一集剧本交给大模型，产出角色、场景、道具、镜头四张表，写回数据库。"""
from sqlalchemy.orm import Session

from .. import prompts
from ..models import Character, Episode, Prop, Scene, Shot
from ..providers import llm
from . import ai
from ..i18n import _

def _known_assets_hint(project) -> str:
    lines = []
    if project.characters:
        lines.append("项目里已有的角色（沿用这些名字和外貌，不要改）：")
        lines += [f"- {c.name}：{c.appearance}" for c in project.characters]
    if project.scenes:
        lines.append("项目里已有的场景（能复用就复用）：")
        lines += [f"- {s.name}：{s.description}" for s in project.scenes]
    if project.props:
        lines.append("项目里已有的道具（沿用这些名字和外观）：")
        lines += [f"- {p.name}：{p.description}" for p in project.props]
    return "\n".join(lines)


def generate(db: Session, episode_id: int, target_seconds: int = 60) -> str:
    ep = db.get(Episode, episode_id)
    if not ep:
        raise ValueError(_(f"分集 {episode_id} 不存在", f"Episode {episode_id} does not exist"))
    if not ep.script.strip():
        raise ValueError(_("这一集还没有剧本", "This episode has no script yet"))
    project = ep.project
    system = prompts.render(prompts.get(db, "storyboard_system"),
                            aspect=project.aspect_ratio, style=project.style)
    user = "\n\n".join(x for x in [
        f"剧名：{project.name}",
        f"第{ep.index}集：{ep.title}",
        f"目标时长：约 {target_seconds} 秒",
        _known_assets_hint(project),
        "剧本：\n" + ep.script,
    ] if x)
    text = ai.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                   purpose=_("拆分镜", "Storyboard"), project_id=project.id,
                   target=_(f"第{ep.index}集", f"Episode {ep.index}"), json_mode=True)
    data = llm.parse_json(text)
    shots = data.get("shots") or []
    if not shots:
        raise ValueError(_("大模型没有返回镜头，原文：", "The LLM returned no shots. Raw output: ") + text[:200])

    # 角色/场景按名字合并：已有的保留（不覆盖用户改过的描述），新的追加
    chars = {c.name: c for c in project.characters}
    for c in data.get("characters") or []:
        name = (c.get("name") or "").strip()
        if name and name not in chars:
            chars[name] = Character(project_id=project.id, name=name,
                                    appearance=c.get("appearance", ""))
            db.add(chars[name])
    scenes = {s.name: s for s in project.scenes}
    for s in data.get("scenes") or []:
        name = (s.get("name") or "").strip()
        if name and name not in scenes:
            scenes[name] = Scene(project_id=project.id, name=name,
                                 description=s.get("description", ""))
            db.add(scenes[name])
    props = {p.name: p for p in project.props}
    for p in data.get("props") or []:
        name = (p.get("name") or "").strip() if isinstance(p, dict) else ""
        if name and name not in props:
            props[name] = Prop(project_id=project.id, name=name, description=p.get("description", ""))
            db.add(props[name])

    # 镜头整表替换
    for old in list(ep.shots):
        db.delete(old)
    db.flush()
    total = 0.0
    for i, s in enumerate(shots, 1):
        try:
            dur = max(1.0, min(15.0, float(s.get("duration") or 4)))
        except (TypeError, ValueError):
            dur = 4.0
        total += dur
        db.add(Shot(
            episode_id=ep.id, index=i,
            scene_name=s.get("scene", ""),
            character_names=[n for n in (s.get("characters") or []) if isinstance(n, str)],
            prop_names=[n for n in (s.get("props") or []) if isinstance(n, str) and n in props],
            shot_type=s.get("shot_type", ""), camera=s.get("camera", ""),
            visual=s.get("visual", ""), dialogue=s.get("dialogue", ""),
            speaker=s.get("speaker", ""), duration=dur,
            image_prompt=s.get("image_prompt", ""), video_prompt=s.get("video_prompt", ""),
        ))
    db.commit()
    return _(f"拆出 {len(shots)} 个镜头，合计 {total:.0f} 秒；角色 {len(chars)} 个，场景 {len(scenes)} 个，道具 {len(props)} 个",
             f"{len(shots)} shots, {total:.0f}s in total; {len(chars)} characters, {len(scenes)} scenes, {len(props)} props")
