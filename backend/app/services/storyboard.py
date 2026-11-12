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


def build_messages(db: Session, ep: Episode, target_seconds: int = 60) -> tuple[str, str]:
    """拆分镜要发给大模型的 (system, user) 两段文字。「复制提示词」到聊天网页用的也是它。"""
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
    return system, user


def generate(db: Session, episode_id: int, target_seconds: int = 60) -> str:
    ep = db.get(Episode, episode_id)
    if not ep:
        raise ValueError(_(f"分集 {episode_id} 不存在", f"Episode {episode_id} does not exist"))
    system, user = build_messages(db, ep, target_seconds)
    project = ep.project
    text = ai.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                   purpose=_("拆分镜", "Storyboard"), project_id=project.id,
                   target=_(f"第{ep.index}集", f"Episode {ep.index}"), json_mode=True)
    data = llm.parse_json(text)
    if not (data.get("shots") if isinstance(data, dict) else None):
        raise ValueError(_("大模型没有返回镜头，原文：", "The LLM returned no shots. Raw output: ") + text[:200])
    return apply(db, ep, data)


def parse_pasted(text: str) -> dict:
    """解析用户从聊天网页（Claude、ChatGPT 等）复制回来的分镜 JSON，出错时给出看得懂的原因。"""
    if not text.strip():
        raise ValueError(_("没有粘贴内容", "Nothing was pasted"))
    try:
        data = llm.parse_json(text)
    except ValueError as e:  # json.JSONDecodeError 是 ValueError 的子类
        raise ValueError(_(f"不是有效的 JSON：{e}。请让 AI 只输出一段完整的 JSON，再整段复制过来",
                           f"Not valid JSON: {e}. Ask the AI to output a single complete JSON block and copy all of it")) from e
    if isinstance(data, list):  # 只给了镜头数组
        data = {"shots": data}
    if not isinstance(data, dict):
        raise ValueError(_("JSON 的最外层应该是 { … } 对象", "The top level of the JSON should be an { … } object"))
    shots = data.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError(_("JSON 里没有 shots（镜头列表），或者它是空的", "The JSON has no \"shots\" list, or it is empty"))
    bad = [i for i, s in enumerate(shots, 1) if not isinstance(s, dict)]
    if bad:
        raise ValueError(_(f"第 {bad[0]} 个镜头格式不对，每个镜头应该是 {{ … }} 对象",
                           f"Shot {bad[0]} is malformed; each shot should be an {{ … }} object"))
    return data


def apply(db: Session, ep: Episode, data: dict) -> str:
    """把分镜 JSON（AI 返回的或用户粘贴的）写进数据库：角色/场景/道具按名字合并，镜头整表替换。"""
    project = ep.project
    shots = data.get("shots") or []

    # 角色/场景按名字合并：已有的保留（不覆盖用户改过的描述），新的追加
    chars = {c.name: c for c in project.characters}
    for c in data.get("characters") or []:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or "").strip()
        if name and name not in chars:
            chars[name] = Character(project_id=project.id, name=name,
                                    appearance=str(c.get("appearance") or ""))
            db.add(chars[name])
    scenes = {s.name: s for s in project.scenes}
    for s in data.get("scenes") or []:
        if not isinstance(s, dict):
            continue
        name = str(s.get("name") or "").strip()
        if name and name not in scenes:
            scenes[name] = Scene(project_id=project.id, name=name,
                                 description=str(s.get("description") or ""))
            db.add(scenes[name])
    props = {p.name: p for p in project.props}
    for p in data.get("props") or []:
        name = str(p.get("name") or "").strip() if isinstance(p, dict) else ""
        if name and name not in props:
            props[name] = Prop(project_id=project.id, name=name, description=str(p.get("description") or ""))
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
        # 粘贴来的 JSON 可能有 null 或数字，统一转成文字
        txt = lambda k: "" if s.get(k) is None else str(s.get(k)).strip()  # noqa: E731
        names = lambda k: [n for n in (s.get(k) or []) if isinstance(n, str)] if isinstance(s.get(k), list) else []  # noqa: E731
        db.add(Shot(
            episode_id=ep.id, index=i,
            scene_name=txt("scene"),
            character_names=names("characters"),
            prop_names=[n for n in names("props") if n in props],
            shot_type=txt("shot_type"), camera=txt("camera"),
            visual=txt("visual"), dialogue=txt("dialogue"),
            speaker=txt("speaker"), duration=dur,
            image_prompt=txt("image_prompt"), video_prompt=txt("video_prompt"),
        ))
    db.commit()
    return _(f"拆出 {len(shots)} 个镜头，合计 {total:.0f} 秒；角色 {len(chars)} 个，场景 {len(scenes)} 个，道具 {len(props)} 个",
             f"{len(shots)} shots, {total:.0f}s in total; {len(chars)} characters, {len(scenes)} scenes, {len(props)} props")
