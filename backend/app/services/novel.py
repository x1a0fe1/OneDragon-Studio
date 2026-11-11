"""导入故事 / 小说并拆成分集。

三种拆法：
- chapter：按「第X章 / 第X回 / Chapter X / 序章 / 番外」这类标题拆；EPUB 按书里的章节文件拆
- length ：按字数切，只在段落之间断开
- ai     ：没有章节标题的故事，交给大模型按剧情切（只返回从第几段开始，原文一个字不改）
"""
import posixpath
import re
import zipfile
from html.parser import HTMLParser
from io import BytesIO
from xml.etree import ElementTree

from .. import prompts
from ..providers import llm
from . import ai
from ..i18n import _

MAX_AI_CHARS = 60000  # AI 分集一次最多处理的字数，再长请先按章节或字数拆

_CN_NUM = "0-9０-９零〇一二两三四五六七八九十百千万"
HEADING = re.compile(
    rf"^\s*(?:"
    rf"第[{_CN_NUM}]+[章回节集卷幕部篇](?:[\s:：、.·—\-]*\S.{{0,40}})?"
    rf"|(?:序章|序言|楔子|引子|尾声|后记|终章|番外)(?:[\s:：、.·—\-]*.{{0,40}})?"
    rf"|chapter\s+[0-9ivxlc]+\b.{{0,40}}"
    rf")\s*$",
    re.IGNORECASE,
)


class ImportErrorMsg(ValueError):
    pass


# ---------- 读文件 ----------
def decode_text(data: bytes) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    for enc in ("utf-8", "gb18030", "big5"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


class _TextExtractor(HTMLParser):
    BLOCKS = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "section", "blockquote"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.heading = ""
        self._in_heading = False
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self._skip += 1
        if tag in self.BLOCKS:
            self.parts.append("\n")
        if tag in ("h1", "h2", "h3") and not self.heading:
            self._in_heading = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head"):
            self._skip = max(0, self._skip - 1)
        if tag in self.BLOCKS:
            self.parts.append("\n")
        if tag in ("h1", "h2", "h3"):
            self._in_heading = False

    def handle_data(self, data):
        if self._skip:
            return
        self.parts.append(data)
        if self._in_heading:
            self.heading += data.strip()


def _html_to_text(raw: bytes) -> tuple[str, str]:
    p = _TextExtractor()
    p.feed(decode_text(raw))
    return p.heading.strip(), normalize("".join(p.parts))


def read_epub(data: bytes) -> list[dict]:
    """按书脊（spine）顺序读出每个章节文件，返回 [{title, text}]。"""
    try:
        z = zipfile.ZipFile(BytesIO(data))
        container = ElementTree.fromstring(z.read("META-INF/container.xml"))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as e:
        raise ImportErrorMsg(_("EPUB 文件损坏或格式不对", "The EPUB file is corrupted or in the wrong format")) from e
    rootfile = next((el.get("full-path") for el in container.iter() if el.tag.endswith("rootfile")), None)
    if not rootfile:
        raise ImportErrorMsg(_("EPUB 里找不到 OPF 文件", "No OPF file found in the EPUB"))
    opf = ElementTree.fromstring(z.read(rootfile))
    base = posixpath.dirname(rootfile)
    manifest = {el.get("id"): el.get("href") for el in opf.iter() if el.tag.endswith("item")}
    spine = [el.get("idref") for el in opf.iter() if el.tag.endswith("itemref")]
    chapters = []
    for idref in spine:
        href = manifest.get(idref)
        if not href:
            continue
        path = posixpath.normpath(posixpath.join(base, href.split("#")[0]))
        try:
            heading, text = _html_to_text(z.read(path))
        except KeyError:
            continue
        if len(text) < 80:  # 封面、目录、版权页
            continue
        title = heading or text.split("\n", 1)[0][:30]
        if text.startswith(title):  # 标题已经单独存了，正文里去掉
            text = text[len(title):].strip()
        chapters.append({"title": title, "text": text})
    if not chapters:
        raise ImportErrorMsg(_("EPUB 里没有读到正文", "No body text found in the EPUB"))
    return chapters


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("　", " ").replace("\xa0", " ")
    lines = [ln.strip() for ln in text.split("\n")]
    out, blank = [], 0
    for ln in lines:
        if ln:
            out.append(ln)
            blank = 0
        elif out and blank == 0:
            out.append("")
            blank = 1
    return "\n".join(out).strip()


def paragraphs(text: str) -> list[str]:
    return [p for p in (x.strip() for x in text.split("\n")) if p]


# ---------- 拆分 ----------
def split_by_headings(text: str) -> list[dict]:
    lines = text.split("\n")
    hits = [i for i, ln in enumerate(lines) if HEADING.match(ln) and len(ln.strip()) <= 50]
    if len(hits) < 2:
        return []
    chapters = []
    preface = "\n".join(lines[:hits[0]]).strip()
    if len(preface) >= 200:  # 第一章之前有一段正文（不是书名作者那种短信息）
        chapters.append({"title": "序", "text": preface})
    for n, start in enumerate(hits):
        end = hits[n + 1] if n + 1 < len(hits) else len(lines)
        body = "\n".join(lines[start + 1:end]).strip()
        if body:
            chapters.append({"title": lines[start].strip(), "text": body})
    return chapters


def split_by_length(text: str, size: int) -> list[dict]:
    size = max(200, int(size))
    chunks, cur, cur_len = [], [], 0
    for p in paragraphs(text):
        if cur and cur_len + len(p) > size * 1.15 and cur_len >= size * 0.6:
            chunks.append(cur)
            cur, cur_len = [], 0
        cur.append(p)
        cur_len += len(p)
    if cur:
        # 最后一段太短就并到前一集
        if chunks and cur_len < size * 0.3:
            chunks[-1].extend(cur)
        else:
            chunks.append(cur)
    return [{"title": "", "text": "\n".join(c)} for c in chunks]


def split_by_ai(text: str, size: int, project_id: int = 0) -> list[dict]:
    paras = paragraphs(text)
    total = sum(len(p) for p in paras)
    if total > MAX_AI_CHARS:
        raise ImportErrorMsg(_(f"文本有 {total} 字，超过 AI 分集一次能处理的 {MAX_AI_CHARS} 字。"
                               "请先用「按章节标题」或「按字数」拆，或者分几次导入。",
                               f"The text has {total} characters, more than the {MAX_AI_CHARS} AI episode splitting "
                               "can handle at once. Split by chapter headings or by length first, or import in parts."))
    if len(paras) < 2:
        raise ImportErrorMsg(_("文本只有一段，没法按段落切分。请在段落之间换行后再试",
                               "The text is a single paragraph and cannot be split. Add line breaks between paragraphs and try again"))
    numbered = "\n".join(f"[{i}] {p}" for i, p in enumerate(paras, 1))
    system = prompts.render(prompts.get_text("episode_split_system"), chars_per_episode=int(size))
    reply = ai.chat([{"role": "system", "content": system},
                     {"role": "user", "content": f"全文共 {len(paras)} 段、{total} 字：\n\n{numbered}"}],
                    purpose=_("按剧情分集", "Split episodes by plot"), project_id=project_id, json_mode=True)
    try:
        items = llm.parse_json(reply).get("episodes") or []
    except ValueError as e:
        raise ImportErrorMsg(_("大模型返回的不是 JSON，可以到「AI 日志」里查看原文",
                               "The LLM did not return JSON; see the raw output in AI Logs")) from e
    starts, titles = [], []
    for it in items:
        try:
            st = int(it.get("start"))
        except (TypeError, ValueError, AttributeError):
            continue
        if 1 <= st <= len(paras) and (not starts or st > starts[-1]):
            starts.append(st)
            titles.append(str(it.get("title") or "").strip()[:30])
    if not starts:
        raise ImportErrorMsg(_("大模型没有给出有效的分集位置，可以到「AI 日志」里查看原文",
                               "The LLM gave no valid episode boundaries; see the raw output in AI Logs"))
    if starts[0] != 1:
        starts[0] = 1
    out = []
    for n, st in enumerate(starts):
        end = starts[n + 1] - 1 if n + 1 < len(starts) else len(paras)
        out.append({"title": titles[n], "text": "\n".join(paras[st - 1:end])})
    return out


def split(text: str, mode: str, size: int = 1500, project_id: int = 0,
          epub_chapters: list[dict] | None = None) -> tuple[list[dict], str]:
    """返回（分集列表, 说明）。"""
    text = normalize(text)
    if not text and not epub_chapters:
        raise ImportErrorMsg(_("没有读到任何文字", "No text was found"))
    if mode == "chapter":
        if epub_chapters:
            return epub_chapters, _(f"按 EPUB 目录拆出 {len(epub_chapters)} 章", f"{len(epub_chapters)} chapters from the EPUB table of contents")
        chapters = split_by_headings(text)
        if chapters:
            return chapters, _(f"识别到 {len(chapters)} 个章节标题", f"Detected {len(chapters)} chapter headings")
        chapters = split_by_length(text, size)
        return chapters, _(f"没有识别到「第X章」这类标题，已改为按约 {size} 字一集切成 {len(chapters)} 集",
                           f"No chapter headings detected; split by about {size} characters per episode into {len(chapters)} episodes")
    if mode == "length":
        chapters = split_by_length(text, size)
        return chapters, _(f"按约 {size} 字一集，切成 {len(chapters)} 集", f"About {size} characters per episode, {len(chapters)} episodes")
    if mode == "ai":
        chapters = split_by_ai(text, size, project_id)
        return chapters, _(f"AI 按剧情切成 {len(chapters)} 集", f"AI split by plot into {len(chapters)} episodes")
    raise ImportErrorMsg(_(f"未知的拆分方式：{mode}", f"Unknown split mode: {mode}"))
