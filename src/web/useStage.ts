import { useCallback, useState } from "react";
import type { DiffPayload } from "../shared/types.ts";

export interface StageApi {
  /** 書き込み操作中かどうか。連打を防ぐのに使う */
  pending: boolean;
  error: string | null;
  stage(paths: readonly string[], staged: boolean): void;
  /** 未ステージの変更を捨てる。呼ぶ前に確認を取ること */
  discard(paths: readonly string[]): void;
}

/**
 * ステージ・破棄の書き込み系 API を叩く。
 *
 * SSE でも変更は飛んでくるが最大 700ms 遅れるので、レスポンスの差分をそのまま
 * 反映して待ち時間を無くす。
 */
export function useStage(onUpdated: (payload: DiffPayload) => void): StageApi {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(
    (url: string, body: unknown) => {
      setPending(true);
      void (async () => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const payload: unknown = await res.json();
          if (!res.ok) {
            const message =
              typeof payload === "object" && payload !== null && "error" in payload
                ? String((payload as { error: unknown }).error)
                : `HTTP ${res.status}`;
            throw new Error(message);
          }
          setError(null);
          onUpdated(payload as DiffPayload);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setPending(false);
        }
      })();
    },
    [onUpdated],
  );

  const stage = useCallback(
    (paths: readonly string[], staged: boolean) => {
      if (paths.length === 0) return;
      post("/api/stage", { paths: [...paths], staged });
    },
    [post],
  );

  const discard = useCallback(
    (paths: readonly string[]) => {
      if (paths.length === 0) return;
      post("/api/discard", { paths: [...paths] });
    },
    [post],
  );

  return { pending, error, stage, discard };
}
