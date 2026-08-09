import type { DiffIndicators } from "@pierre/diffs";
import { useCallback, useEffect, useState } from "react";
import type { ActivityView } from "./ActivityBar.tsx";

export interface Settings {
  /** アクティビティバーで選んでいるビュー */
  sidebarView: ActivityView;
  /** サイドバーのパネルを開いているか */
  sidebarOpen: boolean;
  /** split = 左右 2 カラム / unified = 1 カラム */
  diffStyle: "split" | "unified";
  /** 長い行を折り返すか。false なら横スクロール */
  wordWrap: boolean;
  lineNumbers: boolean;
  /** 追加・削除行の背景を塗るか */
  backgrounds: boolean;
  /** 追加・削除の印。bars = 行頭のバー / classic = +− 記号 */
  diffIndicators: DiffIndicators;
}

export const DEFAULT_SETTINGS: Settings = {
  // 既定はソース管理。ファイラは畳んだ状態から始める
  sidebarView: "scm",
  sidebarOpen: true,
  diffStyle: "split",
  wordWrap: false,
  lineNumbers: true,
  backgrounds: true,
  diffIndicators: "bars",
};

const STORAGE_KEY = "di:settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    // 保存済みの値が古い形でも落ちないように、既定値の上に載せるだけにする
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface SettingsApi extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

/**
 * 表示設定。リポジトリに依らない好みなので、キーは 1 つで使い回す。
 *
 * 初期値の読み込みを遅延初期化にしているのは、localStorage が使えない環境
 * （プライベートモードなど）でも既定値で動かすため。
 */
export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくても表示は続ける
    }
  }, [settings]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);

  return { ...settings, set };
}

/** styles.css のブレークポイントと揃えること。 */
const NARROW_QUERY = "(max-width: 760px)";

/**
 * 画面が狭いかどうか。狭いときは 2 カラム表示が実用にならないので、
 * 設定を書き換えずに 1 カラムで描く。
 */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => globalThis.matchMedia?.(NARROW_QUERY).matches ?? false,
  );

  useEffect(() => {
    const query = globalThis.matchMedia?.(NARROW_QUERY);
    if (query === undefined) return;
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return narrow;
}
