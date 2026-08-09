import { useCallback, useEffect, useRef, useState } from "react";
import type { FileListPayload, FilePayload } from "../shared/types.ts";

/**
 * 差分が変わるたびに取り直すが、中身が同じなら state を差し替えない。
 * 差し替えるとツリーの `resetPaths` や CodeView の再描画が無駄に走る。
 */
function useStableJson<T>(): (next: T) => T {
  const previous = useRef<{ json: string; value: T } | null>(null);

  return useCallback((next: T) => {
    const json = JSON.stringify(next);
    if (previous.current !== null && previous.current.json === json) return previous.current.value;
    previous.current = { json, value: next };
    return next;
  }, []);
}

/** ファイラ用のパス一覧。`revision`（＝差分が変わったタイミング）で取り直す。 */
export function useFileList(revision: number): FileListPayload | null {
  const [list, setList] = useState<FileListPayload | null>(null);
  const stabilize = useStableJson<FileListPayload>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/files", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as FileListPayload;
        if (!cancelled) setList(stabilize(body));
      } catch {
        // 一覧が取れなくても差分表示は続けたいので黙って諦める
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [revision, stabilize]);

  return list;
}

export interface OpenFile {
  payload: FilePayload | null;
  error: string | null;
  loading: boolean;
}

const EMPTY: OpenFile = { payload: null, error: null, loading: false };

/**
 * 選択中のファイルの中身。`revision` が変わったら取り直すが、内容が同じなら
 * payload のオブジェクト同一性を保つので、無関係なファイルを編集しても
 * 開いているファイルは再描画されない。
 */
export function useFileContents(path: string | null, revision: number): OpenFile {
  const [state, setState] = useState<OpenFile>(EMPTY);
  const stabilize = useStableJson<FilePayload>();

  const load = useCallback(
    async (target: string, signal: AbortSignal) => {
      // 同じファイルの取り直しでは loading を立てない（画面が点滅するため）
      setState((current) =>
        current.payload?.path === target ? current : { payload: null, error: null, loading: true },
      );
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(target)}`, {
          cache: "no-store",
          signal,
        });
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof body === "object" && body !== null && "error" in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${res.status}`;
          throw new Error(message);
        }
        if (signal.aborted) return;
        setState({ payload: stabilize(body as FilePayload), error: null, loading: false });
      } catch (err) {
        if (signal.aborted) return;
        setState({
          payload: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        });
      }
    },
    [stabilize],
  );

  useEffect(() => {
    if (path === null) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    void load(path, controller.signal);
    return () => controller.abort();
  }, [path, revision, load]);

  return state;
}
