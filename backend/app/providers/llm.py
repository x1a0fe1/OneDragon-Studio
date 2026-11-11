"""文本大模型。三种协议：

- openai   ：OpenAI 兼容的 /chat/completions（OpenAI、DeepSeek、Gemini、阿里云百炼、火山方舟、Ollama、各类中转）
- azure    ：Azure OpenAI（同样的协议，但用 api-key 请求头，模型名填部署名）
- anthropic：Anthropic Claude，用官方 anthropic SDK 调 Messages API

cfg 里可以填 proxy（比如 http://127.0.0.1:10809），国内访问海外接口时走代理。
"""
import json
import re

import httpx

ANTHROPIC_API = "https://api.anthropic.com"


class LLMError(RuntimeError):
    pass


def protocol(cfg: dict) -> str:
    p = (cfg.get("provider") or "").lower()
    if p in ("anthropic", "azure"):
        return p
    return "openai"


def _base(cfg: dict) -> str:
    return (cfg.get("base_url") or "").strip().rstrip("/")


def _api_root(base: str) -> str:
    """去掉 /chat/completions，得到 /models 等接口的前缀。"""
    if base.endswith("/chat/completions"):
        return base[: -len("/chat/completions")]
    if re.search(r"/(v\d+\w*|openai)$", base):  # .../v1、.../api/v3、Gemini 的 .../v1beta/openai
        return base
    return base + "/v1"


def endpoint(base: str) -> str:
    base = (base or "").rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return _api_root(base) + "/chat/completions"


def _headers(cfg: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    key = (cfg.get("api_key") or "").strip()
    if key:
        if protocol(cfg) == "azure":
            headers["api-key"] = key
        else:
            headers["Authorization"] = f"Bearer {key}"
    return headers


def _proxy(cfg: dict) -> str | None:
    return (cfg.get("proxy") or "").strip() or None


def _check(cfg: dict) -> None:
    if protocol(cfg) != "anthropic" and not _base(cfg):
        raise LLMError("没有配置大模型地址，请到「设置」里填写")
    if not cfg.get("model"):
        raise LLMError("没有配置大模型名称")


# ---------- OpenAI 兼容 ----------
def _openai_complete(cfg: dict, messages: list[dict], json_mode: bool, timeout: float) -> dict:
    body = {"model": cfg["model"], "messages": messages}
    if cfg.get("temperature") is not None:
        body["temperature"] = float(cfg["temperature"])
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        with httpx.Client(proxy=_proxy(cfg), timeout=timeout) as client:
            r = client.post(endpoint(_base(cfg)), headers=_headers(cfg), json=body)
            # 少数兼容接口不认 response_format，去掉再试一次（提示词里本来就要求只输出 JSON）
            if json_mode and r.status_code == 400 and "response_format" in r.text:
                body.pop("response_format")
                r = client.post(endpoint(_base(cfg)), headers=_headers(cfg), json=body)
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


def _openai_models(cfg: dict, timeout: float) -> list[str]:
    try:
        r = httpx.get(_api_root(_base(cfg)) + "/models", headers=_headers(cfg), timeout=timeout, proxy=_proxy(cfg))
    except httpx.HTTPError as e:
        raise LLMError(f"连接失败：{e}") from e
    if r.status_code in (401, 403):
        raise LLMError(f"API Key 无效或没有权限（{r.status_code}）")
    if r.status_code != 200:
        raise LLMError(f"获取模型列表失败（{r.status_code}）：{r.text[:200]}")
    try:
        items = r.json().get("data") or r.json().get("models") or []
    except ValueError as e:
        raise LLMError("模型列表格式无法识别") from e
    ids = [(m.get("id") or m.get("name") or "") if isinstance(m, dict) else str(m) for m in items]
    return sorted({i.removeprefix("models/") for i in ids if i})


# ---------- Anthropic Claude（官方 SDK） ----------
def _anthropic_client(cfg: dict, timeout: float):
    import anthropic
    kw = {"api_key": (cfg.get("api_key") or "").strip() or None, "timeout": timeout, "max_retries": 2}
    base = _base(cfg)
    if base and base.rstrip("/") != ANTHROPIC_API:
        kw["base_url"] = base
    if _proxy(cfg):
        kw["http_client"] = anthropic.DefaultHttpxClient(proxy=_proxy(cfg))
    return anthropic.Anthropic(**kw)


def _anthropic_error(e: Exception) -> LLMError:
    import anthropic
    if isinstance(e, anthropic.AuthenticationError):
        return LLMError("Claude：API Key 无效")
    if isinstance(e, anthropic.PermissionDeniedError):
        return LLMError("Claude：这个 Key 没有权限使用该模型")
    if isinstance(e, anthropic.NotFoundError):
        return LLMError("Claude：模型名不存在，点「获取模型列表」选一个")
    if isinstance(e, anthropic.RateLimitError):
        return LLMError("Claude：请求太频繁或额度用完，稍后再试")
    if isinstance(e, anthropic.APIStatusError):
        return LLMError(f"Claude 返回 {e.status_code}：{e.message}")
    if isinstance(e, anthropic.APIConnectionError):
        return LLMError(f"连接 Claude 失败（国内一般要在设置里填代理）：{e}")
    return LLMError(f"调用 Claude 失败：{e}")


def _anthropic_complete(cfg: dict, messages: list[dict], json_mode: bool, timeout: float) -> dict:
    import anthropic
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    if json_mode:
        system = (system + "\n\n只输出一个 JSON 对象，不要用代码块包裹，也不要任何解释。").strip()
    chat = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
    kw = {"model": cfg["model"], "max_tokens": 16000, "messages": chat}
    if system:
        kw["system"] = system
    # 官方接口上开启服务端 fallback：被安全分类器拒绝时自动换推荐模型重跑；走自定义地址（中转）时不加
    official = not _base(cfg) or _base(cfg) == ANTHROPIC_API
    try:
        client = _anthropic_client(cfg, timeout)
        if official:
            resp = client.beta.messages.create(**kw, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        else:
            resp = client.messages.create(**kw)
    except anthropic.AnthropicError as e:
        raise _anthropic_error(e) from e
    if resp.stop_reason == "refusal":
        raise LLMError("Claude 拒绝了这次请求（安全策略）。可以调整剧本措辞，或换一个模型")
    text = "".join(b.text for b in resp.content if b.type == "text")
    if resp.stop_reason == "max_tokens" and not text.strip():
        raise LLMError("Claude 输出超长被截断，可以把剧本拆短一些")
    return {"content": text, "usage": {"prompt_tokens": resp.usage.input_tokens,
                                       "completion_tokens": resp.usage.output_tokens}}


def _anthropic_models(cfg: dict, timeout: float) -> list[str]:
    import anthropic
    try:
        return sorted(m.id for m in _anthropic_client(cfg, timeout).models.list(limit=100))
    except anthropic.NotFoundError as e:
        raise LLMError("Claude：接口地址不对，官方地址是 https://api.anthropic.com") from e
    except anthropic.AnthropicError as e:
        raise _anthropic_error(e) from e


# ---------- 统一入口 ----------
def complete(cfg: dict, messages: list[dict], json_mode: bool = False, timeout: float = 600) -> dict:
    """返回 {"content": 文本, "usage": {"prompt_tokens", "completion_tokens"}}。"""
    _check(cfg)
    if protocol(cfg) == "anthropic":
        return _anthropic_complete(cfg, messages, json_mode, timeout)
    return _openai_complete(cfg, messages, json_mode, timeout)


def chat(cfg: dict, messages: list[dict], json_mode: bool = False, timeout: float = 600) -> str:
    return complete(cfg, messages, json_mode, timeout)["content"]


def list_models(cfg: dict, timeout: float = 20) -> list[str]:
    """从接口实时拉取可用模型；同时可以当作「Key 是否有效」的检查，不花 tokens。"""
    if protocol(cfg) == "anthropic":
        return _anthropic_models(cfg, timeout)
    if not _base(cfg):
        raise LLMError("先填接口地址")
    return _openai_models(cfg, timeout)


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
