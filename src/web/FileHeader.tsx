import { IconCheck, IconChevronSm } from "@pierre/icons";

interface ToggleProps {
  collapsed: boolean;
  onToggle(): void;
}

/** ファイルヘッダの折りたたみボタン。CodeView の header-prefix スロットに入る。 */
export function CollapseToggle({ collapsed, onToggle }: ToggleProps) {
  return (
    <button
      type="button"
      className="hdr-toggle"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "展開" : "折りたたむ"}
      title={collapsed ? "展開" : "折りたたむ"}
    >
      <IconChevronSm
        size={14}
        className={collapsed ? "hdr-toggle__icon is-collapsed" : "hdr-toggle__icon"}
      />
    </button>
  );
}

interface ViewedProps {
  viewed: boolean;
  onToggle(): void;
}

/** GitHub の「Viewed」相当。チェックすると畳まれる。 */
export function ViewedToggle({ viewed, onToggle }: ViewedProps) {
  return (
    <button
      type="button"
      className={`hdr-viewed${viewed ? " is-on" : ""}`}
      aria-pressed={viewed}
      onClick={onToggle}
      title={viewed ? "表示済みを外す" : "表示済みにする"}
    >
      <IconCheck size={12} />
      表示済み
    </button>
  );
}
