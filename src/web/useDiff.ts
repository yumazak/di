import { useCallback, useEffect, useState } from "react";
import type { DiffPayload } from "../shared/types.ts";

export interface DiffState {
  data: DiffPayload | null;
  error: string | null;
  /** 差分を取り直すたびに増える。CodeView の item version に使う */
  revision: number;
  /** SSE が繋がっているか */
  live: boolean;
  reload(): void;
  /** ステージ操作の応答など、取得済みの差分で置き換える。 */
  replace(payload: DiffPayload): void;
}

/**
 * 差分を取得し、SSE で変更通知を受けたら取り直す。
 * ページを開いている間ずっと最新の差分が出ている状態にするのが目的。
 */
export function useDiff(): DiffState {
  const [data, setData] = useState<DiffPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/diff", { cache: "no-store" });
      const body: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : `HTTP ${res.status}`;
        throw new Error(message);
      }
      setData(body as DiffPayload);
      setError(null);
      setRevision((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();

    const events = new EventSource("/api/events");
    events.addEventListener("open", () => setLive(true));
    events.addEventListener("error", () => setLive(false));
    events.addEventListener("change", () => void load());

    return () => events.close();
  }, [load]);

  const replace = useCallback((payload: DiffPayload) => {
    setData(payload);
    setError(null);
    setRevision((n) => n + 1);
  }, []);

  return { data, error, revision, live, reload: () => void load(), replace };
}
