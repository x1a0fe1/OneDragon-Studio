"""OpenAI 兼容的对话接口（DeepSeek / 通义 / Ollama / 各类中转都走这个协议）。"""
import json
import re

import httpx


class LLMError(RuntimeError):
    pass


def endpoint(base: str) -> str:
    base = (base or "").rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if re.search(r"/v\d+$", base):  # .../v1、火山方舟 .../api/v3
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def complete(cfg: dict, messages: list[dict], json_mode: bool = False, timeout: float = 600) -> dict:
    """返回 {"content": 文本, "usage": {"prompt_tokens", "completion_tokens"}}。"""
    if not (cfg.get("base_url") or "").strip():
        raise LLMError("没有配置大模型地址，请到「设置」里填写")
    if not cfg.get("model"):
        raise LLMError("没有配置大模型名称")
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    body = {"model": cfg["model"], "messages": messages}
    if cfg.get("temperature") is not None:
        body["temperature"] = float(cfg["temperature"])
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        r = httpx.post(endpoint(cfg["base_url"]), headers=headers, json=body, timeout=timeout)
    except httpx.HTTPError as e:
        raise LLMError(f"请求大模型失败：{e}") from e
    if r.status_code != 200:
        raise LLMError(f"大模型返回 {r.status_code}：{r.text[:300]}")
    try:
        data = r.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as e:
        raise LLMError(f"大模型返回格式无法识别：{r.text[:300]}") from e
    usage = data.get("usage") or {}
    return {"content": content or "",
            "usage": {"prompt_tokens": int(usage.get("prompt_tokens") or 0),
                      "completion_tokens": int(usage.get("completion_tokens") or 0)}}


def chat(cfg: dict, messages: list[dict], json_mode: bool = False, timeout: float = 600) -> str:
    return complete(cfg, messages, json_mode, timeout)["content"]


def parse_json(text: str) -> dict:
    """容错解析：去掉 ```json 包裹，截取第一个 { 到最后一个 }。"""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start >= 0 and end > start:
            return json.loads(t[start:end + 1])
        raise
