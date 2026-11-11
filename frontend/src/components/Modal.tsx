import { ReactNode, useEffect } from "react";

/** 通用弹窗：点遮罩、按 Esc、点 × 都会关闭。 */
export default function Modal({ title, onClose, children, wide, footer }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
