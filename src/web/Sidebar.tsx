import { IconChevronSm, IconMinus, IconPlus, IconTrash } from "@pierre/icons";
import type { TreeThemeStyles } from "@pierre/trees";
import { useCallback, useState } from "react";
import { ActivityBar, type ActivityView } from "./ActivityBar.tsx";
import type { Comment } from "./comments.ts";
import { CommentPanel } from "./CommentPanel.tsx";
import { DiffStats } from "./DiffStats.tsx";
import {
  FileTreeFilterButton,
  FileTreeSearchToggle,
  FileTreeView,
  type RepoTree,
} from "./FileBrowser.tsx";
import { FileList } from "./FileList.tsx";
import type { FileEntry } from "./fileStats.ts";

type StageSection = "staged" | "unstaged";

interface Props {
  stagedEntries: readonly FileEntry[];
  unstagedEntries: readonly FileEntry[];
  /** ツリーから開いているファイル。一覧でも同じ行を光らせる */
  activePath: string | null;
  /** 本体に出しているセクション。ファイルを開いているときは null */
  activeSection: StageSection | null;
  view: ActivityView;
  open: boolean;
  onViewChange(view: ActivityView, open: boolean): void;
  isViewed(path: string): boolean;
  onSelectSection(section: StageSection): void;
  onSelect(section: StageSection, path: string): void;
  onStage(paths: readonly string[], staged: boolean): void;
  onDiscard(paths: readonly string[]): void;
  stagePending: boolean;
  /** 変更のあるファイル数。集計に使う */
  changedCount: number;
  tree: RepoTree;
  treeStyle: TreeThemeStyles;
  comments: readonly Comment[];
  onSelectComment(comment: Comment): void;
  onDeleteComment(id: string): void;
  onClearComments(): void;
  viewedCount: number;
}

export function Sidebar(props: Props) {
  // 畳んだセクション。既定はどちらも開いている
  const [folded, setFolded] = useState<ReadonlySet<StageSection>>(() => new Set());

  const toggleFold = useCallback((section: StageSection) => {
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(section)) next.add(section);
      return next;
    });
  }, []);

  const { view, open, onViewChange } = props;
  // 選択中のアイコンをもう一度押したら閉じる。それ以外は開いたまま切り替える
  const selectView = useCallback(
    (next: ActivityView) => onViewChange(next, !(open && next === view)),
    [view, open, onViewChange],
  );

  const totals = [...props.stagedEntries, ...props.unstagedEntries].reduce(
    (acc, entry) => ({
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <div className={`sidebar${open ? "" : " is-collapsed"}`}>
      <ActivityBar
        active={view}
        open={open}
        commentCount={props.comments.length}
        onSelect={selectView}
      />

      {/* パネルは hidden で切り替える。アンマウントするとツリーの展開状態と
          スクロール位置、コメントのコピー状態が飛ぶ */}
      <div className="panel" hidden={!open}>
        <section className="panel__view" aria-label="ソース管理" hidden={view !== "scm"}>
          {props.stagedEntries.length > 0 && (
            <ChangeSection
              title="ステージ済み"
              entries={props.stagedEntries}
              activePath={props.activePath}
              isActive={props.activeSection === "staged"}
              folded={folded.has("staged")}
              onToggleFold={() => toggleFold("staged")}
              isViewed={props.isViewed}
              onActivate={() => props.onSelectSection("staged")}
              onSelect={(path) => props.onSelect("staged", path)}
              stageAction="unstage"
              bulkLabel="すべて解除"
              disabled={props.stagePending}
              onStage={(paths) => props.onStage(paths, false)}
            />
          )}

          <ChangeSection
            title="変更"
            entries={props.unstagedEntries}
            activePath={props.activePath}
            isActive={props.activeSection === "unstaged"}
            folded={folded.has("unstaged")}
            onToggleFold={() => toggleFold("unstaged")}
            isViewed={props.isViewed}
            onActivate={() => props.onSelectSection("unstaged")}
            onSelect={(path) => props.onSelect("unstaged", path)}
            stageAction="stage"
            bulkLabel="すべてステージ"
            disabled={props.stagePending}
            onStage={(paths) => props.onStage(paths, true)}
            onDiscard={props.onDiscard}
          />
        </section>

        <section className="panel__view" aria-label="ファイル" hidden={view !== "files"}>
          <div className="panel__head">
            <h2 className="panel__title">ファイル</h2>
            <FileTreeSearchToggle model={props.tree.model} />
            {props.tree.availableStatuses.size > 1 && <FileTreeFilterButton tree={props.tree} />}
          </div>
          <FileTreeView tree={props.tree} style={props.treeStyle} />
        </section>

        <section className="panel__view" aria-label="コメント" hidden={view !== "comments"}>
          <CommentPanel
            comments={props.comments}
            onSelect={props.onSelectComment}
            onDelete={props.onDeleteComment}
            onClear={props.onClearComments}
          />
        </section>

        <DiffStats
          files={props.changedCount}
          additions={totals.additions}
          deletions={totals.deletions}
          viewed={props.viewedCount}
        />
      </div>
    </div>
  );
}

interface ChangeSectionProps {
  title: string;
  entries: readonly FileEntry[];
  activePath: string | null;
  /** このセクションを本体に出しているか */
  isActive: boolean;
  /** 一覧を畳んでいるか */
  folded: boolean;
  onToggleFold(): void;
  isViewed(path: string): boolean;
  onActivate(): void;
  onSelect(path: string): void;
  stageAction: "stage" | "unstage";
  bulkLabel: string;
  disabled: boolean;
  onStage(paths: readonly string[]): void;
  /** 未ステージのセクションだけ渡す。渡すと破棄の導線が出る */
  onDiscard?: (paths: readonly string[]) => void;
}

/** ソース管理の「ステージ済み」「変更」。見出しは開閉とセクション選択を兼ねる。 */
function ChangeSection(props: ChangeSectionProps) {
  const { entries } = props;
  const totals = entries.reduce(
    (acc, entry) => ({
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const viewed = entries.filter((entry) => props.isViewed(entry.name)).length;

  return (
    <section
      className={`pane pane--changes${props.isActive ? " is-active" : ""}${
        props.folded ? " is-folded" : ""
      }`}
    >
      <h2 className="pane__title">
        <button
          type="button"
          className="pane__fold"
          aria-expanded={!props.folded}
          aria-label={props.folded ? `${props.title}を開く` : `${props.title}を畳む`}
          onClick={props.onToggleFold}
        >
          <IconChevronSm size={13} className={props.folded ? "is-folded" : undefined} />
        </button>
        <button
          type="button"
          className={`pane__reset${props.isActive ? " is-active" : ""}`}
          aria-pressed={props.isActive}
          onClick={props.onActivate}
          disabled={entries.length === 0}
        >
          {props.title}
        </button>
        {entries.length > 0 && (
          <>
            <span className="pane__count">
              {viewed > 0 ? `${viewed}/${entries.length}` : entries.length}
            </span>
            <span className="pane__stats">
              <span className="stat-add">+{totals.additions}</span>
              <span className="stat-del">−{totals.deletions}</span>
            </span>
            {/* 一括操作。文言のボタンを並べると 262px の幅で折り返すので、
                VS Code と同じくアイコンにして title で説明する */}
            {props.onDiscard && (
              <button
                type="button"
                className="pane__action pane__action--danger"
                disabled={props.disabled}
                aria-label="すべて破棄"
                title="すべて破棄（取り消せません）"
                onClick={() => props.onDiscard?.(entries.map((entry) => entry.name))}
              >
                <IconTrash size={12} />
              </button>
            )}
            <button
              type="button"
              className="pane__action"
              disabled={props.disabled}
              aria-label={props.bulkLabel}
              title={props.bulkLabel}
              onClick={() => props.onStage(entries.map((entry) => entry.name))}
            >
              {props.stageAction === "stage" ? <IconPlus size={12} /> : <IconMinus size={12} />}
            </button>
          </>
        )}
      </h2>
      {!props.folded &&
        (entries.length === 0 ? (
          <p className="pane__empty">変更なし</p>
        ) : (
          <FileList
            files={entries}
            activePath={props.activePath}
            isViewed={props.isViewed}
            onSelect={props.onSelect}
            stageAction={props.stageAction}
            stageDisabled={props.disabled}
            onStage={(path) => props.onStage([path])}
            onDiscard={props.onDiscard && ((path: string) => props.onDiscard?.([path]))}
          />
        ))}
    </section>
  );
}
