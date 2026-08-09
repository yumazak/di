import { CHANGE_LABEL, type FileEntry } from "./fileStats.ts";

interface Props {
  files: readonly FileEntry[];
  activeId: string | null;
  isViewed(path: string): boolean;
  onSelect(path: string): void;
  /** ステージ操作のボタン表記（`+` = ステージ、`−` = 解除） */
  stageLabel: string;
  stageDisabled: boolean;
  onStage(path: string): void;
  /** 未ステージのセクションだけ渡す。渡すと破棄ボタンが出る */
  onDiscard?: (path: string) => void;
}

/** 変更ファイルの一覧。クリックでその diff までスクロールする。 */
export function FileList({
  files,
  activeId,
  isViewed,
  onSelect,
  stageLabel,
  stageDisabled,
  onStage,
  onDiscard,
}: Props) {
  return (
    <nav className="file-list" aria-label="変更ファイル">
      {files.map((file) => (
        <div key={file.id} className={`file-list__row${onDiscard ? " has-discard" : ""}`}>
          <button
            type="button"
            className={`file-list__item${file.id === activeId ? " is-active" : ""}${
              isViewed(file.name) ? " is-viewed" : ""
            }`}
            onClick={() => onSelect(file.name)}
            title={file.prevName ? `${file.prevName} → ${file.name}` : file.name}
          >
            <span className={`file-list__badge file-list__badge--${file.type}`}>
              {CHANGE_LABEL[file.type]}
            </span>
            <span className="file-list__name">
              <span className="file-list__dir">{dirOf(file.name)}</span>
              <span className="file-list__base">{baseOf(file.name)}</span>
            </span>
            <span className="file-list__stats">
              {file.additions > 0 && <span className="stat-add">+{file.additions}</span>}
              {file.deletions > 0 && <span className="stat-del">−{file.deletions}</span>}
            </span>
          </button>
          {onDiscard && (
            <button
              type="button"
              className="file-list__discard"
              disabled={stageDisabled}
              onClick={() => onDiscard(file.name)}
              aria-label="変更を破棄"
              title="変更を破棄（取り消せません）"
            >
              ↩
            </button>
          )}
          <button
            type="button"
            className="file-list__stage"
            disabled={stageDisabled}
            onClick={() => onStage(file.name)}
            aria-label={stageLabel === "+" ? "ステージに入れる" : "ステージから出す"}
            title={stageLabel === "+" ? "ステージに入れる" : "ステージから出す"}
          >
            {stageLabel}
          </button>
        </div>
      ))}
    </nav>
  );
}

function baseOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * ディレクトリ部分。長いパスは頭を省略したいので CSS 側で `direction: rtl` にしており、
 * そのままだと末尾の `/` が先頭に回ってしまう。LRM を足して並び順を固定する。
 */
function dirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : `${path.slice(0, index + 1)}‎`;
}
