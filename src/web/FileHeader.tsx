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
      {collapsed ? "▸" : "▾"}
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
    <label className={`hdr-viewed${viewed ? " is-on" : ""}`}>
      <input type="checkbox" checked={viewed} onChange={onToggle} />
      表示済み
    </label>
  );
}

/** まとめ表示でどちらのセクションの差分か分かるようにする印。 */
export function SectionBadge() {
  return <span className="hdr-section">ステージ済み</span>;
}
