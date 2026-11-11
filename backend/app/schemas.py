from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProjectIn(BaseModel):
    name: str
    description: str = ""
    style: str = "国风动漫，精致线条，电影感光影"
    aspect_ratio: str = "9:16"


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    style: str | None = None
    aspect_ratio: str | None = None


class ProjectOut(ORM):
    id: int
    name: str
    description: str
    style: str
    aspect_ratio: str
    created_at: datetime


class EpisodeIn(BaseModel):
    title: str = ""
    script: str = ""
    index: int | None = None


class EpisodePatch(BaseModel):
    title: str | None = None
    script: str | None = None
    index: int | None = None


class EpisodeBrief(ORM):
    id: int
    project_id: int
    index: int
    title: str
    shot_count: int = 0


class CharacterIn(BaseModel):
    name: str
    appearance: str = ""
    image_prompt: str = ""


class CharacterPatch(BaseModel):
    name: str | None = None
    appearance: str | None = None
    image_prompt: str | None = None
    voice: str | None = None


class CharacterOut(ORM):
    id: int
    project_id: int
    name: str
    appearance: str
    image_prompt: str
    ref_image: str
    voice: str = ""


class SceneIn(BaseModel):
    name: str
    description: str = ""
    image_prompt: str = ""


class ScenePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    image_prompt: str | None = None


class SceneOut(ORM):
    id: int
    project_id: int
    name: str
    description: str
    image_prompt: str
    ref_image: str


class PropIn(BaseModel):
    name: str
    description: str = ""
    image_prompt: str = ""


class PropPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    image_prompt: str | None = None


class PropOut(ORM):
    id: int
    project_id: int
    name: str
    description: str
    image_prompt: str
    ref_image: str


class ShotPatch(BaseModel):
    scene_name: str | None = None
    character_names: list[str] | None = None
    prop_names: list[str] | None = None
    shot_type: str | None = None
    camera: str | None = None
    visual: str | None = None
    dialogue: str | None = None
    speaker: str | None = None
    duration: float | None = None
    image_prompt: str | None = None
    video_prompt: str | None = None


class ShotOut(ORM):
    id: int
    episode_id: int
    index: int
    scene_name: str
    character_names: list[str]
    prop_names: list[str] = []
    shot_type: str
    camera: str
    visual: str
    dialogue: str
    speaker: str
    duration: float
    image_prompt: str
    video_prompt: str
    image_path: str
    video_path: str
    audio_path: str = ""
    audio_duration: float = 0.0

    @field_validator("character_names", "prop_names", mode="before")
    @classmethod
    def _none_list(cls, v):
        return v or []


class EpisodeOut(ORM):
    id: int
    project_id: int
    index: int
    title: str
    script: str
    final_path: str = ""
    srt_path: str = ""
    final_duration: float = 0.0
    shots: list[ShotOut] = []


class ProjectDetail(ProjectOut):
    episodes: list[EpisodeBrief] = []
    characters: list[CharacterOut] = []
    scenes: list[SceneOut] = []
    props: list[PropOut] = []


class TaskOut(ORM):
    id: int
    kind: str
    kind_label: str = ""
    target_id: int
    project_id: int
    status: str
    attempts: int
    max_attempts: int
    error: str
    message: str
    created_at: datetime
    updated_at: datetime


# ---------- 导入故事 / 小说 ----------
class ChapterPreview(BaseModel):
    title: str
    text: str
    chars: int


class ImportPreview(BaseModel):
    source: str          # 文件名或「粘贴的文本」
    total_chars: int
    note: str            # 用什么方式拆出了几集
    chapters: list[ChapterPreview]


class ImportChapter(BaseModel):
    title: str = ""
    text: str


class ImportCommit(BaseModel):
    chapters: list[ImportChapter]


# ---------- 素材库 ----------
class LibraryIn(BaseModel):
    kind: str
    name: str
    description: str = ""
    image_prompt: str = ""
    voice: str = ""
    tags: str = ""


class LibraryPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    image_prompt: str | None = None
    voice: str | None = None
    tags: str | None = None


class LibraryOut(ORM):
    id: int
    kind: str
    name: str
    description: str
    image_prompt: str
    image: str
    voice: str
    tags: str
    created_at: datetime
    updated_at: datetime


class SaveToLibrary(BaseModel):
    kind: str            # character | scene | prop
    id: int              # 项目里资产的 id


class ImportFromLibrary(BaseModel):
    ids: list[int]


# ---------- AI 日志 ----------
class LLMLogBrief(ORM):
    id: int
    created_at: datetime
    purpose: str
    project_id: int
    target: str
    model: str
    status: str
    error: str
    duration_ms: int
    prompt_tokens: int
    completion_tokens: int


class LLMLogOut(LLMLogBrief):
    base_url: str
    messages: list
    response: str
