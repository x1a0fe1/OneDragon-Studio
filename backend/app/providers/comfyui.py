"""ComfyUI 供应商：提交「API 格式」工作流 → 等它跑完 → 把产物下载回来。

不绑定任何具体模型。你在 ComfyUI 里搭好能用的工作流，用「导出 (API)」得到 JSON，
再把需要每次替换的输入值改成占位符，例如把正向提示词节点的 "text" 改成 "{{prompt}}"。

- 整个值就是占位符（"{{width}}"）时，按原类型替换，数字还是数字；
- 占位符夹在文字中间（"masterpiece, {{prompt}}"）时，按文字拼接。
"""
import json
import mimetypes
import random
import re
import time
import uuid
from pathlib import Path
from typing import Callable

import httpx

from ..i18n import _

PLACEHOLDERS = {
    "prompt": "正向提示词",
    "negative": "反向提示词",
    "seed": "随机种子（每次不同）",
    "width": "宽（按画面比例和设置的长边算好）",
    "height": "高",
    "image": "首帧图文件名（图生视频，自动上传到 ComfyUI）",
    "ref_image_1": "参考图 1（参考图生图，自动上传；不够 3 张时重复使用前面的）",
    "ref_image_2": "参考图 2",
    "ref_image_3": "参考图 3",
    "frames": "帧数（按时长 × 帧率，取 4n+1）",
    "fps": "帧率",
    "duration": "时长（秒）",
    "filename_prefix": "输出文件名前缀",
}

_PH = re.compile(r"\{\{\s*(\w+)\s*\}\}")
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".gif"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


class ComfyError(RuntimeError):
    """ComfyUI 执行出错（可能是显存不够、临时故障），值得重试。"""


class WorkflowError(ComfyError):
    """工作流本身有问题（格式不对、节点缺失、占位符不认识），重试也没用。"""


def parse_workflow(text: str) -> dict:
    try:
        wf = json.loads(text)
    except json.JSONDecodeError as e:
        raise WorkflowError(_(f"工作流不是合法的 JSON：{e}", f"Workflow is not valid JSON: {e}")) from e
    if isinstance(wf, dict) and "nodes" in wf and "links" in wf:
        raise WorkflowError(_("这是 ComfyUI 的普通保存格式。请在 ComfyUI 菜单里用「导出 (API)」重新导出", "This is ComfyUI's regular save format. Re-export it from the ComfyUI menu with \"Export (API)\""))
    if not isinstance(wf, dict) or not wf or not all(
            isinstance(n, dict) and "class_type" in n for n in wf.values()):
        raise WorkflowError(_("看不出是 ComfyUI 的 API 格式工作流（应该是 {节点ID: {class_type, inputs}}）", "Doesn't look like a ComfyUI API-format workflow (expected {node_id: {class_type, inputs}})"))
    return wf


def placeholders_in(obj) -> set[str]:
    found: set[str] = set()
    if isinstance(obj, str):
        found.update(_PH.findall(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            found |= placeholders_in(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= placeholders_in(v)
    return found


def fill(obj, values: dict):
    """把占位符换成实际值，返回新对象。"""
    def lookup(name: str):
        if name not in values:
            raise WorkflowError(_(f"工作流里的占位符 {{{{{name}}}}} 在这一步用不了。可用：", f"Workflow placeholder {{{{{name}}}}} is not available in this step. Available: ")
                                + _("、", ", ").join(sorted(values)))
        return values[name]

    if isinstance(obj, str):
        m = _PH.fullmatch(obj.strip())
        if m:
            return lookup(m.group(1))
        return _PH.sub(lambda m: str(lookup(m.group(1))), obj)
    if isinstance(obj, dict):
        return {k: fill(v, values) for k, v in obj.items()}
    if isinstance(obj, list):
        return [fill(v, values) for v in obj]
    return obj


def new_seed() -> int:
    return random.randint(0, 2**48)


class Client:
    def __init__(self, cfg: dict):
        self.base = (cfg.get("base_url") or "").rstrip("/")
        if not self.base:
            raise WorkflowError(_("没有配置 ComfyUI 地址，请到「设置」里填写", "No ComfyUI URL configured. Fill it in under Settings"))
        self.timeout = float(cfg.get("timeout_sec") or 1800)
        self.http = httpx.Client(base_url=self.base, timeout=60)

    def close(self):
        self.http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _get(self, path: str, **params):
        try:
            r = self.http.get(path, params=params or None)
        except httpx.HTTPError as e:
            raise ComfyError(f"连不上 ComfyUI（{self.base}）：{e}") from e
        r.raise_for_status()
        return r

    def stats(self) -> dict:
        return self._get("/system_stats").json()

    def upload(self, path: Path) -> str:
        """上传本地图片到 ComfyUI 的 input 目录，返回 LoadImage 节点要填的文件名。"""
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        # 加前缀避免和别的项目同名覆盖
        name = f"onedragon_{path.name}"
        try:
            r = self.http.post("/upload/image", files={"image": (name, path.read_bytes(), mime)},
                               data={"overwrite": "true", "type": "input"})
        except httpx.HTTPError as e:
            raise ComfyError(_(f"上传图片到 ComfyUI 失败：{e}", f"Failed to upload image to ComfyUI: {e}")) from e
        if r.status_code != 200:
            raise ComfyError(_(f"上传图片到 ComfyUI 失败：{r.status_code} {r.text[:200]}", f"Failed to upload image to ComfyUI: {r.status_code} {r.text[:200]}"))
        j = r.json()
        return f"{j['subfolder']}/{j['name']}" if j.get("subfolder") else j["name"]

    def run(self, workflow: dict, progress: Callable[[str], None] | None = None) -> dict:
        """提交并等待完成，返回 history 里的 outputs。"""
        try:
            r = self.http.post("/prompt", json={"prompt": workflow, "client_id": uuid.uuid4().hex})
        except httpx.HTTPError as e:
            raise ComfyError(f"连不上 ComfyUI（{self.base}）：{e}") from e
        if r.status_code != 200:
            raise WorkflowError(_("ComfyUI 拒绝了这个工作流：", "ComfyUI rejected this workflow: ") + _describe_rejection(r))
        prompt_id = r.json()["prompt_id"]

        start = time.monotonic()
        last_report = 0.0
        while True:
            waited = time.monotonic() - start
            if waited > self.timeout:
                try:
                    self.http.post("/queue", json={"delete": [prompt_id]})
                    self.http.post("/interrupt", json={"prompt_id": prompt_id})
                except httpx.HTTPError:
                    pass
                raise ComfyError(_(f"ComfyUI 超过 {self.timeout:.0f} 秒还没出结果，已放弃", f"ComfyUI produced no result after {self.timeout:.0f}s, gave up"))
            entry = self._get(f"/history/{prompt_id}").json().get(prompt_id)
            if entry:
                status = entry.get("status") or {}
                if status.get("status_str") == "error":
                    raise ComfyError(_("ComfyUI 执行出错：", "ComfyUI execution error: ") + _describe_error(status))
                if status.get("completed", True):
                    return entry.get("outputs") or {}
            if progress and waited - last_report >= 10:
                last_report = waited
                progress(_(f"ComfyUI 生成中，已等待 {waited:.0f} 秒", f"ComfyUI generating, waited {waited:.0f}s"))
            time.sleep(2)

    def download(self, f: dict, dest: Path) -> Path:
        r = self._get("/view", filename=f["filename"], subfolder=f.get("subfolder", ""), type=f.get("type", "output"))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        return dest


def output_files(outputs: dict, exts: set[str]) -> list[dict]:
    """从 outputs 里挑出指定扩展名的文件；正式输出（type=output）排在预览（temp）前面。"""
    found = []
    for node_out in outputs.values():
        for items in node_out.values():
            if not isinstance(items, list):
                continue
            for it in items:
                if isinstance(it, dict) and "filename" in it and Path(it["filename"]).suffix.lower() in exts:
                    found.append(it)
    found.sort(key=lambda it: it.get("type") != "output")
    return found


def _describe_rejection(r: httpx.Response) -> str:
    try:
        j = r.json()
    except ValueError:
        return f"{r.status_code} {r.text[:300]}"
    parts = [(j.get("error") or {}).get("message", "")]
    for node_id, ne in (j.get("node_errors") or {}).items():
        for err in ne.get("errors", []):
            parts.append(_(f"节点 {node_id}（{ne.get('class_type', '')}）：{err.get('message', '')} {err.get('details', '')}",
                            f"Node {node_id} ({ne.get('class_type', '')}): {err.get('message', '')} {err.get('details', '')}").strip())
    return _("；", "; ").join(p for p in parts if p) or str(j)[:300]


def _describe_error(status: dict) -> str:
    for kind, info in status.get("messages") or []:
        if kind == "execution_error":
            return _(f"{info.get('node_type', '')} 节点：{info.get('exception_message', '')}",
                     f"{info.get('node_type', '')} node: {info.get('exception_message', '')}").strip()
    return json.dumps(status, ensure_ascii=False)[:300]
