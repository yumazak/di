import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface Props {
  /** トリガーボタンの中身 */
  trigger: ReactNode;
  label: string;
  /** パネルの中身。閉じている間はマウントされない */
  children: ReactNode;
  className?: string;
  /** パネルの右端をトリガーに揃える（既定）／左端に揃える */
  align?: "end" | "start";
}

/**
 * トップバーのドロップダウン。
 *
 * `popover` 属性や `<dialog>` ではなくただの絶対配置にしているのは、パネルを開いた
 * ままビューアをスクロールしたいから。モーダルにするとテーマを試しながら差分を
 * 眺められない。
 */
export function Popover({ trigger, label, children, className, align = "end" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    // pointerdown で閉じる。click まで待つと、外側のボタンを押したときに
    // 「閉じる」と「そのボタンの操作」が二重に走って見える
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`popover${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-button${open ? " is-active" : ""}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          className={`popover__panel popover__panel--${align}`}
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}
