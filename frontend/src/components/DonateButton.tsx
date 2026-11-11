import { useEffect, useState } from "react";
import { PAYPAL_URL } from "../donate";
import { t } from "../i18n";

/** 收款码放在 frontend/public/donate/ 下；哪张图不存在，对应的卡片就自动隐藏。 */
const codes = () => [
  { key: "wechat", label: t("微信", "WeChat"), caption: t("微信扫一扫", "Scan with WeChat"), alt: t("微信收款码", "WeChat Pay QR code"), src: "/donate/wechat.jpg", color: "#07c160" },
  { key: "alipay", label: t("支付宝", "Alipay"), caption: t("支付宝扫一扫", "Scan with Alipay"), alt: t("支付宝收款码", "Alipay QR code"), src: "/donate/alipay.jpg", color: "#1677ff" },
];

const contacts = (): { key: string; label: string; value: string; href?: string; hint?: string }[] => [
  { key: "email", label: t("邮箱", "Email"), value: "bajiebujiese@126.com", href: "mailto:bajiebujiese@126.com" },
  { key: "wechat-oa", label: t("公众号", "WeChat Official Account"), value: "IT架构师修炼", hint: t("微信里搜索关注", "Search it in WeChat") },
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
  return <button className="small-btn copy-btn" onClick={copy}>{done ? t("已复制", "Copied") : t("复制", "Copy")}</button>;
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
export default function DonateButton({ variant = "button", label = t("请我喝奶茶", "Buy me a milk tea") }: {
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

  const shown = codes().filter((c) => !missing.includes(c.key));

  return (
    <>
      <button className={variant === "link" ? "donate-link" : "donate-btn"} onClick={() => { setMissing([]); setOpen(true); }}
        title={t("觉得好用？请作者喝杯奶茶", "Find it useful? Buy the author a milk tea")}>
        <MilkTeaIcon />
        <span>{label}</span>
      </button>

      {open && (
        <div className="modal-mask" onClick={() => setOpen(false)}>
          <div className="modal donate" role="dialog" aria-modal="true" aria-label={t("请我喝奶茶", "Buy me a milk tea")} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setOpen(false)} aria-label={t("关闭", "Close")}>×</button>
            <div className="donate-head">
              <MilkTeaIcon />
              <h2>{t("请我喝杯奶茶", "Buy Me a Milk Tea")}</h2>
            </div>
            <p className="muted">
              {t("OneDragon Studio 是免费开源的个人项目。如果它帮你省下了时间，欢迎扫码请我喝杯奶茶，这会让我更有动力继续做下去。", "OneDragon Studio is a free, open-source personal project. If it saves you time, scan a code to buy me a milk tea; it keeps me motivated to keep going. ")}
              {t("不打赏也完全没关系，给项目点个 Star、提个建议，同样感谢！", "No tip? No problem at all. A star or a suggestion is just as appreciated!")}
            </p>
            {shown.length > 0 ? (
              <div className="qr-row">
                {shown.map((c) => (
                  <figure key={c.key} className="qr-card">
                    <img src={c.src} alt={c.alt}
                      onError={() => setMissing((m) => (m.includes(c.key) ? m : [...m, c.key]))} />
                    <figcaption style={{ background: c.color }}>{c.caption}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="error small">{t("收款码图片加载失败：请确认 start.bat 的窗口还开着（服务在运行），然后关闭弹窗再点一次。", "Failed to load the QR codes. Make sure the start.bat window is still open (the server is running), then close this dialog and try again.")}</p>
            )}
            {PAYPAL_URL && (
              <div className="paypal-row">
                <a className="paypal-btn" href={PAYPAL_URL} target="_blank" rel="noreferrer">PayPal</a>
                <span className="muted small">{t("海外用户可用 PayPal 或银行卡", "Pay with PayPal or card")}</span>
              </div>
            )}
            <div className="contact">
              <div className="contact-title">{t("联系作者", "Contact the author")} <span className="muted small">{t("问题反馈、合作、交流都可以", "Feedback, collaboration or just a chat")}</span></div>
              {contacts().map((c) => (
                <div key={c.key} className="contact-row">
                  <span className="contact-label">{c.label}</span>
                  {c.href ? <a href={c.href}>{c.value}</a> : <b>{c.value}</b>}
                  {c.hint && <span className="muted small">{c.hint}</span>}
                  <CopyButton text={c.value} />
                </div>
              ))}
            </div>
            <p className="muted small center">{t("谢谢你的每一份支持 ♥", "Thank you for every bit of support ♥")}</p>
          </div>
        </div>
      )}
    </>
  );
}
