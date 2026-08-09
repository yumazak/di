import type { DiffLineAnnotation } from "@pierre/diffs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AnnotationMeta,
  type Comment,
  type Draft,
  loadComments,
  newComment,
  saveComments,
} from "./comments.ts";

export interface CommentsApi {
  comments: Comment[];
  draft: Draft | null;
  /** そのパスに出す注釈（保存済み + 下書き）。 */
  annotationsFor(path: string): DiffLineAnnotation<AnnotationMeta>[] | undefined;
  /** そのパスの注釈が変わるたびに増える。CodeView の item version に足す。 */
  annotationVersion(path: string): number;
  add(target: Draft, body: string): void;
  remove(id: string): void;
  clear(): void;
  openDraft(target: Draft): void;
  closeDraft(): void;
}

/**
 * コメントの状態・永続化・注釈への変換をまとめて持つ。
 *
 * バージョンはパスごとに持つ。全体で 1 つのカウンタにすると、コメントを 1 件足した
 * だけで表示中の全ファイルが再描画されてしまう。
 *
 * 操作系のコールバックは全部 ref 経由にして identity を固定してある。これらは
 * CodeView の `options` / `renderAnnotation` に渡るので、identity が変わるたびに
 * 全アイテムが作り直されてしまうため。
 */
export function useComments(repoRoot: string | null): CommentsApi {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});

  const commentsRef = useRef(comments);
  const draftRef = useRef(draft);
  const repoRootRef = useRef(repoRoot);
  commentsRef.current = comments;
  draftRef.current = draft;
  repoRootRef.current = repoRoot;

  const bump = useCallback((paths: Iterable<string>) => {
    setVersions((current) => {
      const next = { ...current };
      for (const path of paths) next[path] = (next[path] ?? 0) + 1;
      return next;
    });
  }, []);

  const commit = useCallback((next: Comment[]) => {
    const root = repoRootRef.current;
    if (root !== null) saveComments(root, next);
    setComments(next);
  }, []);

  // リポジトリが確定したら保存済みコメントを読み込む
  useEffect(() => {
    if (repoRoot === null) return;
    const loaded = loadComments(repoRoot);
    setComments(loaded);
    setDraft(null);
    bump(new Set(loaded.map((c) => c.path)));
  }, [repoRoot, bump]);

  const add = useCallback(
    (target: Draft, body: string) => {
      commit([...commentsRef.current, newComment(target, body)]);
      setDraft(null);
      bump([target.path]);
    },
    [commit, bump],
  );

  const remove = useCallback(
    (id: string) => {
      const hit = commentsRef.current.find((c) => c.id === id);
      commit(commentsRef.current.filter((c) => c.id !== id));
      if (hit) bump([hit.path]);
    },
    [commit, bump],
  );

  const clear = useCallback(() => {
    bump(new Set(commentsRef.current.map((c) => c.path)));
    commit([]);
  }, [commit, bump]);

  const openDraft = useCallback(
    (target: Draft) => {
      const touched = new Set([target.path]);
      const previous = draftRef.current;
      if (previous) touched.add(previous.path);
      setDraft(target);
      bump(touched);
    },
    [bump],
  );

  const closeDraft = useCallback(() => {
    const previous = draftRef.current;
    if (previous) bump([previous.path]);
    setDraft(null);
  }, [bump]);

  const byPath = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<AnnotationMeta>[]>();
    const push = (path: string, annotation: DiffLineAnnotation<AnnotationMeta>) => {
      const list = map.get(path);
      if (list) list.push(annotation);
      else map.set(path, [annotation]);
    };

    for (const comment of comments) {
      push(comment.path, {
        side: comment.side,
        lineNumber: comment.line,
        metadata: { kind: "comment", comment },
      });
    }
    if (draft) {
      // 下書きの内容を注釈に載せておくと、描画側が draft を閉じ込めずに済む
      push(draft.path, {
        side: draft.side,
        lineNumber: draft.line,
        metadata: { kind: "draft", draft },
      });
    }
    return map;
  }, [comments, draft]);

  return {
    comments,
    draft,
    annotationsFor: (path) => byPath.get(path),
    annotationVersion: (path) => versions[path] ?? 0,
    add,
    remove,
    clear,
    openDraft,
    closeDraft,
  };
}
