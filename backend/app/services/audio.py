"""台词配音：每个有台词的镜头生成一段语音，按说话人选音色。"""
import hashlib
import re

from sqlalchemy.orm import Session

from .. import settings_store
from ..config import MEDIA_DIR
from ..models import Project, Shot, Task
from ..providers import ffmpeg, tts
from .errors import TaskAbort
from .media import new_rel_path, remove_file, set_file

_FEMALE_HINTS = ("女", "姑娘", "小姐", "夫人", "公主", "妃", "娘", "少女", "母亲", "婆")
_STAGE_DIRECTIONS = re.compile(r"（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]")


def clean_line(text: str) -> str:
    """去掉（冷笑）这类舞台提示和引号，剩下真正要念、要上字幕的话。"""
    t = _STAGE_DIRECTIONS.sub("", text or "")
    t = re.sub(r"[“”\"「」『』]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def voice_for(shot: Shot, project: Project, cfg: dict) -> str:
    speaker = (shot.speaker or "").strip()
    if speaker and speaker != "旁白":
        c = next((x for x in project.characters if x.name == speaker), None)
        if c:
            if c.voice.strip():
                return c.voice.strip()
            female = any(h in c.appearance for h in _FEMALE_HINTS)
            return cfg.get("female_voice" if female else "male_voice") or ""
    return cfg.get("narrator_voice") or ""


def audio_key(text: str, voice: str, cfg: dict) -> str:
    raw = f"{cfg.get('provider')}|{voice}|{cfg.get('speed')}|{cfg.get('model')}|{text}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def needs_audio(shot: Shot, project: Project, cfg: dict) -> bool:
    text = clean_line(shot.dialogue)
    if not text:
        return bool(shot.audio_path)  # 台词删掉了，旧配音要清掉
    if not shot.audio_path or not (MEDIA_DIR / shot.audio_path).is_file():
        return True
    return shot.audio_key != audio_key(text, voice_for(shot, project, cfg), cfg)


def make_shot_audio(db: Session, shot: Shot) -> str:
    project = shot.episode.project
    cfg = settings_store.get(db, "tts") or {}
    text = clean_line(shot.dialogue)
    if not text:
        if shot.audio_path:
            old = shot.audio_path
            shot.audio_path, shot.audio_duration, shot.audio_key = "", 0.0, ""
            db.commit()
            remove_file(old)
        return f"镜头 #{shot.index} 没有台词，不需要配音"
    voice = voice_for(shot, project, cfg)
    rel = new_rel_path(project.id, f"e{shot.episode_id}", f"shot{shot.id}_voice", ".mp3")
    try:
        tts.synthesize(cfg, text, voice, MEDIA_DIR / rel)
    except tts.TTSError as e:
        if "未知的配音供应商" in str(e) or "没有配置" in str(e):
            raise TaskAbort(str(e)) from e
        raise
    shot.audio_duration = round(ffmpeg.duration(MEDIA_DIR / rel), 2)
    shot.audio_key = audio_key(text, voice, cfg)
    set_file(db, shot, "audio_path", rel)
    return f"镜头 #{shot.index} 配音 {shot.audio_duration:.1f} 秒（{voice}）"


def shot_audio(db: Session, task: Task) -> str:
    s = db.get(Shot, task.target_id)
    if not s:
        raise TaskAbort("镜头已被删除")
    return make_shot_audio(db, s)
