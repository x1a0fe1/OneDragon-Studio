"""接口返回的提示、报错、任务进度的中英双语。

用法：from ..i18n import _ ；raise HTTPException(400, _("先填写剧本", "Write a script first"))
带变量直接用 f-string：_(f"拆出 {n} 个镜头", f"{n} shots")

当前语言来自请求头 X-Lang（前端每个请求都会带）；后台任务把创建时的语言存在 params["lang"]，
执行时再设回来，所以任务进度和报错用的是发起任务时的界面语言。
"""
from contextvars import ContextVar

_lang: ContextVar[str] = ContextVar("lang", default="zh")


def _(zh: str, en: str) -> str:
    return en if _lang.get() == "en" else zh


def get_lang() -> str:
    return _lang.get()


def set_lang(lang: str | None) -> None:
    _lang.set("en" if (lang or "").lower().startswith("en") else "zh")
