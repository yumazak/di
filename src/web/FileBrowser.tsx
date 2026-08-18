import { IconFilter, IconSearch, IconXSquircle } from "@pierre/icons";
import type { FileTree as FileTreeModel, GitStatus, TreeThemeStyles } from "@pierre/trees";
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileListPayload } from "../shared/types.ts";
import { Popover } from "./Popover.tsx";

/**
 * ツリーの見た目の微調整。
 *
 * - 検索欄はトグルで開くまで畳んでおく（`search: true` だと常に場所を取る）
 * - フォルダは少しコントラストを上げて、ファイル行と区別できるようにする
 */
const TREE_CSS = `
  [data-file-tree-search-container][data-open='false'] {
    display: none;
  }

  [data-file-tree-search-container] {
    margin-bottom: 8px;
    padding-bottom: 8px;
    padding-inline: 2px 6px;
    border-bottom: 1px solid var(--color-border, rgb(128 128 128 / 0.2));
  }

  [data-file-tree-virtualized-scroll='true'] {
    padding-inline: 0 2px;
  }

  [data-item-type='folder'] {
    color: color-mix(in lab, light-dark(#000, #fff) 25%, var(--trees-fg));
    font-weight: 500;
  }
`;

/** 差分に出うる状態だけをフィルタの候補にする。色はツリー側の印と揃えてある。 */
const STATUS_ITEMS: { status: GitStatus; label: string; short: string; color: string }[] = [
  { status: "added", label: "追加", short: "A", color: "light-dark(#16a994, #00cab1)" },
  { status: "modified", label: "変更", short: "M", color: "light-dark(#1ca1c7, #08c0ef)" },
  { status: "renamed", label: "リネーム", short: "R", color: "light-dark(#d5a910, #ffd452)" },
  { status: "deleted", label: "削除", short: "D", color: "light-dark(#ff2e3f, #ff6762)" },
  { status: "untracked", label: "未追跡", short: "U", color: "light-dark(#7d8590, #9aa4b2)" },
];

export interface RepoTree {
  model: FileTreeModel;
  loading: boolean;
  availableStatuses: ReadonlySet<GitStatus>;
  selectedStatuses: ReadonlySet<GitStatus>;
  toggleStatus(status: GitStatus): void;
  isolateStatus(status: GitStatus): void;
  clearStatuses(): void;
}

/**
 * VS Code のエクスプローラ相当。変更の有無にかかわらずリポジトリ全部を出す。
 *
 * モデルはサイドバー側で持たせる。検索トグルとフィルタのボタンはタブ行に並べたいので、
 * ツリー本体と同じ場所からモデルを触れる必要がある。
 */
export function useRepoTree(
  list: FileListPayload | null,
  onOpen: (path: string) => void,
): RepoTree {
  const [selectedStatuses, setSelectedStatuses] = useState<ReadonlySet<GitStatus>>(() => new Set());

  const statuses = useMemo(() => list?.statuses ?? [], [list]);
  const availableStatuses = useMemo(
    () => new Set(statuses.map((entry) => entry.status as GitStatus)),
    [statuses],
  );

  // 絞り込み中は該当ファイルだけ残す。ヒットしないフォルダは自然に消える
  const paths = useMemo(() => {
    const all = list?.paths ?? [];
    if (selectedStatuses.size === 0) return all;
    const keep = new Set(
      statuses
        .filter((entry) => selectedStatuses.has(entry.status as GitStatus))
        .map((entry) => entry.path),
    );
    return all.filter((path) => keep.has(path));
  }, [list, statuses, selectedStatuses]);

  const { model } = useFileTree({
    paths,
    // 単一の子しか持たないフォルダは `a/b/c` と 1 行にまとめる。深い階層で
    // 中身のないフォルダ行が積み上がるのを防ぐ
    flattenEmptyDirectories: true,
    // 全部開いた状態だと、少し大きいリポジトリでいきなり数百行になる。
    // VS Code のエクスプローラと同じく畳んだ状態から始める
    initialExpansion: "closed",
    search: true,
    stickyFolders: true,
    unsafeCSS: TREE_CSS,
  });

  // paths / statuses はライブリロードで変わるのでモデル側へ流し込む
  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  useEffect(() => {
    model.setGitStatus(statuses);
  }, [model, statuses]);

  const selected = useFileTreeSelection(model);
  const treeSelection = selected[0] ?? null;

  useEffect(() => {
    // ディレクトリを選んだときは開かない（末尾が / のパスはディレクトリ）
    if (treeSelection === null || treeSelection.endsWith("/")) return;
    onOpen(treeSelection);
  }, [treeSelection, onOpen]);

  const toggleStatus = useCallback((status: GitStatus) => {
    setSelectedStatuses((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  }, []);

  // Alt+クリックはその状態だけに絞る。すでに単独で選ばれていれば解除する
  const isolateStatus = useCallback((status: GitStatus) => {
    setSelectedStatuses((current) =>
      current.size === 1 && current.has(status) ? new Set() : new Set([status]),
    );
  }, []);

  const clearStatuses = useCallback(() => setSelectedStatuses(new Set()), []);

  return {
    model,
    loading: list === null,
    availableStatuses,
    selectedStatuses,
    toggleStatus,
    isolateStatus,
    clearStatuses,
  };
}

const TREE_STYLE = { height: "100%" } as const;

export function FileTreeView({ tree, style }: { tree: RepoTree; style: TreeThemeStyles }) {
  if (tree.loading) return <p className="pane__empty">読み込み中…</p>;
  return <FileTree model={tree.model} style={{ ...style, ...TREE_STYLE }} />;
}

/** ツリー内蔵の検索欄を開閉する。 */
export function FileTreeSearchToggle({ model }: { model: FileTreeModel }) {
  const search = useFileTreeSearch(model);
  return (
    <button
      type="button"
      className={`icon-button${search.isOpen ? " is-active" : ""}`}
      aria-label={search.isOpen ? "ファイル検索を閉じる" : "ファイルを検索"}
      title="ファイルを検索"
      aria-pressed={search.isOpen}
      // 検索欄はフォーカスが外れると閉じる。preventDefault しないと blur → click の
      // 順に走って、閉じた直後にまた開いてしまう
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => (search.isOpen ? search.close() : search.open())}
    >
      <IconSearch size={14} />
    </button>
  );
}

/** Git の状態でツリーを絞り込む。 */
export function FileTreeFilterButton({ tree }: { tree: RepoTree }) {
  const filtered = tree.selectedStatuses.size > 0;
  const items = STATUS_ITEMS.filter((item) => tree.availableStatuses.has(item.status));
  // onClick には altKey が乗ってくるが、チェックボックスの change には乗らないので
  // pointerdown の時点で拾っておく
  const altRef = useRef(false);
  const [isMac] = useState(
    () => typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent),
  );

  return (
    <Popover
      label="Git の状態で絞り込む"
      trigger={
        <>
          <IconFilter size={14} />
          {filtered && <span className="icon-button__dot" />}
        </>
      }
    >
      <>
        <p className="menu__hint">
          Git の状態で絞り込む
          <small>{isMac ? "Option" : "Alt"}+クリックでその状態だけ表示</small>
        </p>
        {items.map(({ status, label, short, color }) => (
          <label
            key={status}
            className={`menu__row menu__row--clickable${
              filtered && !tree.selectedStatuses.has(status) ? " is-dimmed" : ""
            }`}
            onPointerDown={(event) => {
              altRef.current = event.altKey;
            }}
          >
            <span
              className="menu__badge"
              style={{ color, backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
            >
              {short}
            </span>
            <span className="menu__value">{label}</span>
            <input
              type="checkbox"
              checked={tree.selectedStatuses.has(status)}
              onChange={() =>
                altRef.current ? tree.isolateStatus(status) : tree.toggleStatus(status)
              }
            />
          </label>
        ))}
        <button
          type="button"
          className="menu__item"
          disabled={!filtered}
          onClick={tree.clearStatuses}
        >
          <IconXSquircle size={14} />
          <span className="menu__value">絞り込みを解除</span>
        </button>
      </>
    </Popover>
  );
}
