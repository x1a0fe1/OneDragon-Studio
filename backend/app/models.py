"""数据模型：项目 → 分集 → 镜头；项目下挂角色、场景、道具三类资产；跨项目的素材库；所有耗时操作走 Task 队列。"""
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now():
    return datetime.now()


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    style: Mapped[str] = mapped_column(String(200), default="国风动漫，精致线条，电影感光影")
    aspect_ratio: Mapped[str] = mapped_column(String(10), default="9:16")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    episodes: Mapped[list["Episode"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Episode.index")
    characters: Mapped[list["Character"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Character.id")
    scenes: Mapped[list["Scene"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Scene.id")
    props: Mapped[list["Prop"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Prop.id")


class Episode(Base):
    __tablename__ = "episodes"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    index: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200), default="")
    script: Mapped[str] = mapped_column(Text, default="")
    final_path: Mapped[str] = mapped_column(String(500), default="")  # 合成好的成片
    srt_path: Mapped[str] = mapped_column(String(500), default="")    # 对应的字幕文件
    final_duration: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    project: Mapped[Project] = relationship(back_populates="episodes")
    shots: Mapped[list["Shot"]] = relationship(
        back_populates="episode", cascade="all, delete-orphan", order_by="Shot.index")


class Character(Base):
    __tablename__ = "characters"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    appearance: Mapped[str] = mapped_column(Text, default="")   # 外貌、服装、气质（中文）
    image_prompt: Mapped[str] = mapped_column(Text, default="")  # 生成参考图用的提示词
    ref_image: Mapped[str] = mapped_column(String(500), default="")  # 相对 MEDIA_DIR 的路径
    voice: Mapped[str] = mapped_column(String(100), default="")      # 配音音色；空 = 按设置里的默认音色

    project: Mapped[Project] = relationship(back_populates="characters")


class Scene(Base):
    __tablename__ = "scenes"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    image_prompt: Mapped[str] = mapped_column(Text, default="")
    ref_image: Mapped[str] = mapped_column(String(500), default="")

    project: Mapped[Project] = relationship(back_populates="scenes")


class Prop(Base):
    """道具：信物、武器、书信这类会反复出现、需要保持一致的物件。"""
    __tablename__ = "props"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    image_prompt: Mapped[str] = mapped_column(Text, default="")
    ref_image: Mapped[str] = mapped_column(String(500), default="")

    project: Mapped[Project] = relationship(back_populates="props")


class LibraryItem(Base):
    """跨项目素材库：从项目里存进来的角色/场景/道具，可以再导入到别的项目。图片单独复制一份。"""
    __tablename__ = "library_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))                   # character | scene | prop
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")      # 角色 = 外貌；场景/道具 = 描述
    image_prompt: Mapped[str] = mapped_column(Text, default="")
    image: Mapped[str] = mapped_column(String(500), default="")     # 相对 MEDIA_DIR，放在 library/ 下
    voice: Mapped[str] = mapped_column(String(100), default="")     # 只有角色用
    tags: Mapped[str] = mapped_column(String(200), default="")      # 自由标签，方便搜索（比如来源剧名）
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class LLMLog(Base):
    """每次调用大模型的记录：发了什么、回了什么、耗时多久。不记录 API Key。"""
    __tablename__ = "llm_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    purpose: Mapped[str] = mapped_column(String(50), default="")    # 拆分镜 / 分集 / 测试连接 …
    project_id: Mapped[int] = mapped_column(Integer, default=0)
    target: Mapped[str] = mapped_column(String(100), default="")    # 比如「第3集」
    model: Mapped[str] = mapped_column(String(100), default="")
    base_url: Mapped[str] = mapped_column(String(300), default="")
    messages: Mapped[list] = mapped_column(JSON, default=list)
    response: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="ok")   # ok | error
    error: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)


class Shot(Base):
    __tablename__ = "shots"
    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"))
    index: Mapped[int] = mapped_column(Integer, default=1)
    scene_name: Mapped[str] = mapped_column(String(100), default="")
    character_names: Mapped[list] = mapped_column(JSON, default=list)
    prop_names: Mapped[list] = mapped_column(JSON, default=list)
    shot_type: Mapped[str] = mapped_column(String(50), default="")   # 景别：特写/近景/中景/全景/远景
    camera: Mapped[str] = mapped_column(String(100), default="")     # 运镜：固定/推/拉/摇/跟
    visual: Mapped[str] = mapped_column(Text, default="")            # 画面描述（中文）
    dialogue: Mapped[str] = mapped_column(Text, default="")          # 台词/旁白
    speaker: Mapped[str] = mapped_column(String(100), default="")    # 说话人；旁白写「旁白」
    duration: Mapped[float] = mapped_column(Float, default=4.0)      # 秒
    image_prompt: Mapped[str] = mapped_column(Text, default="")      # 首帧图提示词
    video_prompt: Mapped[str] = mapped_column(Text, default="")      # 图生视频提示词（动作+运镜）
    image_path: Mapped[str] = mapped_column(String(500), default="")
    video_path: Mapped[str] = mapped_column(String(500), default="")
    audio_path: Mapped[str] = mapped_column(String(500), default="")   # 台词配音
    audio_duration: Mapped[float] = mapped_column(Float, default=0.0)
    audio_key: Mapped[str] = mapped_column(String(64), default="")    # 生成时的台词+音色指纹，变了就要重配

    episode: Mapped[Episode] = relationship(back_populates="shots")


class Task(Base):
    """后台任务。状态：pending → running → done / failed；失败按 max_attempts 自动重试。"""
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(50))          # 见 services/tasks.py 的 HANDLERS
    target_id: Mapped[int] = mapped_column(Integer)
    project_id: Mapped[int] = mapped_column(Integer, default=0)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error: Mapped[str] = mapped_column(Text, default="")
    message: Mapped[str] = mapped_column(Text, default="")   # 进度/结果说明
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict | list | str | int | float | None] = mapped_column(JSON)
