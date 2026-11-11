"""全局路径与默认配置。运行期可改的配置（API Key、ComfyUI 地址等）存数据库 settings 表。"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
# 数据目录可以用环境变量 ONEDRAGON_DATA_DIR 换到别处（比如跑测试时不碰真实数据）
DATA_DIR = Path(os.environ.get("ONEDRAGON_DATA_DIR") or BACKEND_DIR / "data")
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "onedragon.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(exist_ok=True)

# 设置项默认值；前端「设置」页可改
DEFAULT_SETTINGS = {
    "llm": {
        "base_url": "https://api.deepseek.com",
        "api_key": "",
        "model": "deepseek-chat",
        "temperature": 0.7,
    },
    # image / video 供应商：mock（演示占位） | comfyui | aliyun（阿里云百炼） | volcengine（火山方舟）
    "image_provider": "mock",
    "video_provider": "mock",
    "comfyui": {
        "base_url": "http://127.0.0.1:8188",
        "timeout_sec": 1800,
        # 「API 格式」工作流 JSON，里面用 {{prompt}} 之类的占位符，见 providers/comfyui.py
        "image_workflow": "",       # 文生图：角色/场景参考图、没有参考图的镜头首帧
        "ref_image_workflow": "",   # 参考图生图（可选）：镜头首帧带上角色/场景参考图，人物更稳定
        "video_workflow": "",       # 图生视频
        "negative_prompt": "低质量，模糊，变形，畸形的手，多余的手指，文字，水印，签名",
        "image_long_side": 1280,
        "video_long_side": 832,
        "fps": 16,
    },
    # 云端生图 / 生视频（providers/cloud.py）。模型名会随平台更新，以平台控制台的模型列表为准
    "aliyun": {
        "base_url": "https://dashscope.aliyuncs.com",  # 也可以填业务空间专属域名
        "api_key": "",
        "image_model": "wan2.6-t2i",         # 文生图（没有参考图时）
        "ref_image_model": "wan2.6-image",   # 带参考图生图（1～4 张）
        "video_model": "wan2.6-i2v-flash",   # 首帧生视频
        "video_resolution": "720P",
        "video_min_seconds": 2,
        "video_max_seconds": 15,
        "use_refs": True,
    },
    "volcengine": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "api_key": "",
        "image_model": "doubao-seedream-5-0-pro-260628",  # 文生图和参考图生图是同一个模型
        "video_model": "doubao-seedance-2-5-260628",
        "video_resolution": "720p",
        "video_min_seconds": 4,
        "video_max_seconds": 30,
        "use_refs": True,
    },
    # 配音：edge（微软 Edge 在线朗读，免费免 Key，非官方接口）| openai（OpenAI 兼容的 /audio/speech）| mock（静音占位）
    "tts": {
        "provider": "edge",
        "female_voice": "zh-CN-XiaoxiaoNeural",
        "male_voice": "zh-CN-YunxiNeural",
        "narrator_voice": "zh-CN-YunjianNeural",
        "speed": 1.0,
        "base_url": "",
        "api_key": "",
        "model": "",
    },
    # 合成成片
    "compose": {
        "long_side": 1280,          # 成片分辨率（长边）
        "fps": 25,
        "subtitles": True,          # 把台词烧进画面
        "subtitle_size": 0.045,     # 字号 = 画面短边 × 这个比例
        "ai_label": "AI生成",       # AI 生成内容标识，留空不加（按平台规定建议保留）
        "ai_label_position": "top-right",
        "tail_padding": 0.3,        # 每句台词说完后多停留的秒数
    },
    "worker": {"max_attempts": 3},
    # 用户改过的提示词模板，键见 prompts.DEFAULTS；留空 = 默认
    "prompts": {},
}

SECRET_KEYS = {("llm", "api_key"), ("tts", "api_key"), ("aliyun", "api_key"), ("volcengine", "api_key")}
