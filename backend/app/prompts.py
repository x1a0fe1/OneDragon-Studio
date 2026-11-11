"""可在「提示词」页修改的提示词模板。

模板里用 {变量名} 引用变量，只替换下面列出的变量；其余花括号（比如 JSON 示例）原样保留，不需要转义。
用户改过的版本存在 settings 表的 "prompts" 里；留空 = 用这里的默认值。
"""
import re

from sqlalchemy.orm import Session

from .i18n import _

STORYBOARD_SYSTEM = """你是一名资深的竖屏漫剧分镜导演。用户会给你一集短剧剧本，你要把它拆成可以直接交给 AI 生图、生视频的分镜表。

要求：
1. 先列出本集出现的角色、场景和关键道具。角色写清楚：性别、年龄感、发型发色、五官特点、服装、标志性配饰；同一角色全剧外貌保持一致。场景写清楚：地点、时代、时间（白天/夜晚）、光线、关键陈设。道具只列推动剧情、会反复出现或需要特写的物件（信物、武器、书信等），写清楚材质、颜色、形状、纹样；普通桌椅杯盘不要列。
2. 再按剧情顺序拆镜头。每个镜头 2～6 秒，一个镜头只表达一个动作或一句台词。整集镜头时长加起来要贴近用户给的目标时长。
3. 竖屏构图（{aspect}），景别多用近景、中景、特写，冲突处给特写。
4. image_prompt 写首帧画面：谁、在哪、什么姿态表情、景别、光线，用中文，可直接作为生图提示词，不要写台词。画风统一为：{style}。
5. video_prompt 写这几秒内的动作和运镜，简洁具体，比如「镜头缓慢推近，她抬眼冷笑，衣袖被风吹起」。
6. 台词保持剧本原意，可以略微口语化；没有台词的镜头 dialogue 留空；旁白的 speaker 写「旁白」。
7. 只输出 JSON，不要任何解释。

JSON 结构：
{
  "characters": [{"name": "角色名", "appearance": "外貌服装描述"}],
  "scenes": [{"name": "场景名", "description": "场景描述"}],
  "props": [{"name": "道具名", "description": "道具外观描述"}],
  "shots": [{
    "scene": "场景名（必须来自 scenes）",
    "characters": ["出镜角色名（必须来自 characters）"],
    "props": ["画面里出现的道具名（必须来自 props，没有就留空数组）"],
    "shot_type": "特写|近景|中景|全景|远景",
    "camera": "固定|推|拉|摇|移|跟|升|降",
    "visual": "画面内容（给人看的简要描述）",
    "dialogue": "台词或旁白",
    "speaker": "说话人",
    "duration": 4,
    "image_prompt": "首帧生图提示词",
    "video_prompt": "动作与运镜提示词"
  }]
}"""

EPISODE_SPLIT_SYSTEM = """你是短剧编剧。用户会给你一篇按段落编号的故事或小说，你要按剧情把它切成若干集竖屏短剧，每集是一段完整的小情节，结尾最好留一个钩子。

要求：
1. 只能在段落之间切开，不能改写、删减或打乱原文。
2. 每集大约 {chars_per_episode} 字；剧情需要时可以多一些或少一些，但不要把一个完整场景从中间切断。
3. 给每集起一个吸引人的短标题（不超过 12 个字，不要带「第几集」）。
4. 只输出 JSON，不要任何解释：
{"episodes": [{"title": "标题", "start": 起始段落编号}]}
第一集的 start 必须是 1，start 要严格递增。"""

DEFAULTS = {
    "storyboard_system": {
        "label": ("AI 拆分镜", "AI storyboard breakdown"),
        "desc": ("把一集剧本拆成角色、场景、道具和镜头表。改动时请保留 JSON 结构说明，否则程序读不懂返回结果。",
                 "Breaks an episode script into characters, scenes, props and a shot list. Keep the JSON structure description when editing, or the app can't parse the result."),
        "vars": {"aspect": ("画面比例", "Aspect ratio"), "style": ("项目画风", "Project art style")},
        "text": STORYBOARD_SYSTEM,
    },
    "episode_split_system": {
        "label": ("AI 按剧情分集", "AI episode splitting"),
        "desc": ("导入没有章节标题的故事时，让 AI 按剧情切分成若干集。",
                 "When importing a story without chapter headings, the AI splits it into episodes by plot."),
        "vars": {"chars_per_episode": ("每集目标字数", "Target characters per episode")},
        "text": EPISODE_SPLIT_SYSTEM,
    },
    "character_image": {
        "label": ("角色参考图", "Character reference image"),
        "desc": ("角色的「生图提示词」留空时，用这个模板生成。", "Used when a character's image prompt is left blank."),
        "vars": {"name": ("角色名", "Character name"), "appearance": ("外貌描述", "Appearance"), "style": ("项目画风", "Project art style")},
        "text": "角色设定图，同一人物的正面、侧面、背面三视图，纯白背景，全身站姿，{appearance}，{style}",
    },
    "scene_image": {
        "label": ("场景参考图", "Scene reference image"),
        "desc": ("场景的「生图提示词」留空时，用这个模板生成。", "Used when a scene's image prompt is left blank."),
        "vars": {"name": ("场景名", "Scene name"), "description": ("场景描述", "Scene description"), "style": ("项目画风", "Project art style")},
        "text": "场景设定图，空镜无人物，{description}，{style}",
    },
    "prop_image": {
        "label": ("道具参考图", "Prop reference image"),
        "desc": ("道具的「生图提示词」留空时，用这个模板生成。", "Used when a prop's image prompt is left blank."),
        "vars": {"name": ("道具名", "Prop name"), "description": ("道具描述", "Prop description"), "style": ("项目画风", "Project art style")},
        "text": "道具设定图，单个物件居中特写，纯白背景，无人物，{name}，{description}，{style}",
    },
}


def render(template: str, **values) -> str:
    """只替换已知变量，其他花括号保持原样。"""
    def sub(m):
        key = m.group(1)
        return str(values[key]) if key in values else m.group(0)
    return re.sub(r"\{(\w+)\}", sub, template)


def get(db: Session, key: str) -> str:
    from . import settings_store  # 避免循环导入
    custom = (settings_store.get(db, "prompts") or {}).get(key) or ""
    return custom if custom.strip() else DEFAULTS[key]["text"]


def get_text(key: str) -> str:
    """不在请求/任务会话里时用：自己开一个会话读。"""
    from .db import SessionLocal
    with SessionLocal() as db:
        return get(db, key)


def listing(db: Session) -> list[dict]:
    from . import settings_store
    custom = settings_store.get(db, "prompts") or {}
    return [{"key": k, "label": _(*v["label"]), "desc": _(*v["desc"]),
             "vars": {name: _(*pair) for name, pair in v["vars"].items()}, "default": v["text"],
             "value": custom.get(k) or "", "customized": bool((custom.get(k) or "").strip())}
            for k, v in DEFAULTS.items()]
