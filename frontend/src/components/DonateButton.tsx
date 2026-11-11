import { useEffect, useState } from "react";

/** 收款码放在 frontend/public/donate/ 下；哪张图不存在，对应的卡片就自动隐藏。 */
const CODES = [
  { key: "wechat", label: "微信", src: "/donate/wechat.jpg", color: "#07c160" },
  { key: "alipay", label: "支付宝", src: "/donate/alipay.jpg", color: "#1677ff" },
];

const CONTACTS: { label: string; value: string; href?: string; hint?: string }[] = [
  { label: "邮箱", value: "bajiebujiese@126.com", href: "mailto:bajiebujiese@126.com" },
  { label: "公众号", value: "IT架构师修炼", hint: "微信里搜索关注" },
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 非 https / 老浏览器拿不到剪贴板权限时的兜底
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return <button className="small-btn copy-btn" onClick={copy}>{done ? "已复制" : "复制"}</button>;
}

function MilkTeaIcon() {
  return (
    <svg className="milk-tea" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M14.5 1.5 12.6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M5 6h14l-1.6 14.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8L5 6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6.2 11h11.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9.5" cy="17.5" r="1.1" fill="currentColor" />
      <circle cx="12.5" cy="18.6" r="1.1" fill="currentColor" />
      <circle cx="14.8" cy="16.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

/**
 * 「请我喝奶茶」入口，每个实例自带收款码弹窗。
 * variant：button = 胶囊按钮（侧边栏、关于卡片）；link = 一行文字链接（成片下面）。
 */
export default function DonateButton({ variant = "button", label = "请我喝奶茶" }: {
  variant?: "button" | "link";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shown = CODES.filter((c) => !missing.includes(c.key));

  return (
    <>
      <button className={variant === "link" ? "donate-link" : "donate-btn"} onClick={() => { setMissing([]); setOpen(true); }}
        title="觉得好用？请作者喝杯奶茶">
        <MilkTeaIcon />
        <span>{label}</span>
      </button>

      {open && (
        <div className="modal-mask" onClick={() => setOpen(false)}>
          <div className="modal donate" role="dialog" aria-modal="true" aria-label="请我喝奶茶" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            <div className="donate-head">
              <MilkTeaIcon />
              <h2>请我喝杯奶茶</h2>
            </div>
            <p className="muted">
              {"OneDragon Studio 是免费开源的个人项目。如果它帮你省下了时间，欢迎扫码请我喝杯奶茶，这会让我更有动力继续做下去。"}
              {"不打赏也完全没关系，给项目点个 Star、提个建议，同样感谢！"}
            </p>
            {shown.length > 0 ? (
              <div className="qr-row">
                {shown.map((c) => (
                  <figure key={c.key} className="qr-card">
                    <img src={c.src} alt={`${c.label}收款码`}
                      onError={() => setMissing((m) => (m.includes(c.key) ? m : [...m, c.key]))} />
                    <figcaption style={{ background: c.color }}>{c.label}扫一扫</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="error small">收款码图片加载失败：请确认 start.bat 的窗口还开着（服务在运行），然后关闭弹窗再点一次。</p>
            )}
            <div className="contact">
              <div className="contact-title">联系作者 <span className="muted small">问题反馈、合作、交流都可以</span></div>
              {CONTACTS.map((c) => (
                <div key={c.label} className="contact-row">
                  <span className="contact-label">{c.label}</span>
                  {c.href ? <a href={c.href}>{c.value}</a> : <b>{c.value}</b>}
                  {c.hint && <span className="muted small">{c.hint}</span>}
                  <CopyButton text={c.value} />
                </div>
              ))}
            </div>
            <p className="muted small center">谢谢你的每一份支持 ♥</p>
          </div>
        </div>
      )}
    </>
  );
}
