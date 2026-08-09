import { useCallback, useEffect, useRef, useState } from "react";

export interface ReviewState {
  isCollapsed(path: string): boolean;
  isViewed(path: string): boolean;
  /** 折りたたみ・表示済みが変わるたびに増える。CodeView の item version に足す。 */
  version(path: string): number;
  viewedCount: number;
  toggleCollapsed(path: string): void;
  toggleViewed(path: string): void;
  setAllCollapsed(paths: readonly string[], collapsed: boolean): void;
}

const STORAGE_PREFIX = "di:viewed:";

function loadViewed(repoRoot: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + repoRoot);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveViewed(repoRoot: string, viewed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify([...viewed]));
  } catch {
    // 保存できなくても表示は続ける
  }
}

/**
 * ファイル単位の折りたたみと「表示済み」。
 *
 * 表示済みは GitHub と同じくレビューの進捗管理なので localStorage に残す。
 * 折りたたみは一時的な見た目なので残さない。
 *
 * コールバックは CodeView の `renderHeaderPrefix` などに渡るため、identity を
 * 固定しないと全アイテムが作り直される。
 */
export function useReviewState(repoRoot: string | null): ReviewState {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  const [versions, setVersions] = useState<Record<string, number>>({});

  const collapsedRef = useRef(collapsed);
  const viewedRef = useRef(viewed);
  const repoRootRef = useRef(repoRoot);
  collapsedRef.current = collapsed;
  viewedRef.current = viewed;
  repoRootRef.current = repoRoot;

  const bump = useCallback((paths: Iterable<string>) => {
    setVersions((current) => {
      const next = { ...current };
      for (const path of paths) next[path] = (next[path] ?? 0) + 1;
      return next;
    });
  }, []);

  useEffect(() => {
    if (repoRoot === null) return;
    const loaded = loadViewed(repoRoot);
    setViewed(loaded);
    // 表示済みのファイルは畳んだ状態で開く
    setCollapsed(new Set(loaded));
    bump(loaded);
  }, [repoRoot, bump]);

  const toggleCollapsed = useCallback(
    (path: string) => {
      const next = new Set(collapsedRef.current);
      if (!next.delete(path)) next.add(path);
      setCollapsed(next);
      bump([path]);
    },
    [bump],
  );

  const toggleViewed = useCallback(
    (path: string) => {
      const nextViewed = new Set(viewedRef.current);
      const nowViewed = !nextViewed.delete(path);
      if (nowViewed) nextViewed.add(path);
      setViewed(nextViewed);

      const root = repoRootRef.current;
      if (root !== null) saveViewed(root, nextViewed);

      // GitHub と同じく、見終わったら畳む・戻したら開く
      const nextCollapsed = new Set(collapsedRef.current);
      if (nowViewed) nextCollapsed.add(path);
      else nextCollapsed.delete(path);
      setCollapsed(nextCollapsed);

      bump([path]);
    },
    [bump],
  );

  const setAllCollapsed = useCallback(
    (paths: readonly string[], value: boolean) => {
      setCollapsed(value ? new Set(paths) : new Set());
      bump(paths);
    },
    [bump],
  );

  return {
    isCollapsed: (path) => collapsed.has(path),
    isViewed: (path) => viewed.has(path),
    version: (path) => versions[path] ?? 0,
    viewedCount: viewed.size,
    toggleCollapsed,
    toggleViewed,
    setAllCollapsed,
  };
}
