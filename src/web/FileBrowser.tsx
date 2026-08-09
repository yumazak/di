import type { TreeThemeStyles } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react";
import { useEffect, useMemo } from "react";
import type { FileListPayload } from "../shared/types.ts";

interface Props {
  list: FileListPayload | null;
  onOpen(path: string): void;
  /** テーマから作ったツリーの配色 */
  style: TreeThemeStyles;
}

const TREE_STYLE = { height: "100%" } as const;

/** VS Code のエクスプローラ相当。変更の有無にかかわらずリポジトリ全部を出す。 */
export function FileBrowser({ list, onOpen, style }: Props) {
  const paths = useMemo(() => list?.paths ?? [], [list]);

  const { model } = useFileTree({
    paths,
    initialExpansion: "open",
    search: true,
  });

  // paths / statuses はライブリロードで変わるのでモデル側へ流し込む
  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  useEffect(() => {
    model.setGitStatus(list?.statuses ?? []);
  }, [model, list?.statuses]);

  const selected = useFileTreeSelection(model);
  const treeSelection = selected[0] ?? null;

  useEffect(() => {
    // ディレクトリを選んだときは開かない（末尾が / のパスはディレクトリ）
    if (treeSelection === null || treeSelection.endsWith("/")) return;
    onOpen(treeSelection);
  }, [treeSelection, onOpen]);

  if (list === null) return <p className="pane__empty">読み込み中…</p>;

  return <FileTree model={model} style={{ ...style, ...TREE_STYLE }} />;
}
