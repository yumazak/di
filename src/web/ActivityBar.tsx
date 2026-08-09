import { IconBranch, IconComment, IconFileTree } from "@pierre/icons";

export type ActivityView = "scm" | "files" | "comments";

const VIEWS: { value: ActivityView; label: string; Icon: typeof IconBranch }[] = [
  { value: "scm", label: "ソース管理", Icon: IconBranch },
  { value: "files", label: "ファイル", Icon: IconFileTree },
  { value: "comments", label: "コメント", Icon: IconComment },
];

interface Props {
  active: ActivityView;
  /** パネルを開いているか。閉じているとどのアイコンも選択状態にしない */
  open: boolean;
  commentCount: number;
  onSelect(view: ActivityView): void;
}

/**
 * VS Code のアクティビティバー。ビューの切り替えと、パネル自体の開閉を兼ねる。
 * 選択中のアイコンをもう一度押すとパネルが閉じる。
 */
export function ActivityBar({ active, open, commentCount, onSelect }: Props) {
  return (
    <nav className="rail" aria-label="ビュー">
      {VIEWS.map(({ value, label, Icon }) => {
        const selected = open && active === value;
        return (
          <button
            key={value}
            type="button"
            className={`rail__item${selected ? " is-active" : ""}`}
            aria-label={label}
            aria-pressed={selected}
            title={selected ? `${label}（閉じる）` : label}
            onClick={() => onSelect(value)}
          >
            <Icon size={17} />
            {value === "comments" && commentCount > 0 && (
              <span className="rail__badge">{commentCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
