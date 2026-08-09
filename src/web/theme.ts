import type { ThemesType, ThemeTypes } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import {
  createThemeCatalog,
  createThemeController,
  type ColorMode,
  type ColorScheme,
  type ThemeLike,
} from "@pierre/theming";
import { colorUtils, normalizeThemeColors } from "@pierre/theming/color";
import { useThemeController } from "@pierre/theming/react";
import { themes } from "@pierre/theming/themes";
import { themeToTreeStyles, type TreeThemeStyles } from "@pierre/trees";
import { useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react";

/**
 * 差分のシンタックステーマ一覧。`@pierre/diffs` は pierre-* を内部で登録済みなので、
 * ここで選んだ名前はそのまま CodeView の `theme` に渡せる。
 */
export const themeCatalog = createThemeCatalog({
  themes,
  defaultLightThemeName: "pierre-light",
  defaultDarkThemeName: "pierre-dark",
});

/**
 * テーマの状態（モード・明暗それぞれの選択・永続化）の唯一の持ち主。
 * モジュール単位のシングルトンなので、再マウントしても選択が保たれる。
 */
export const themeController = createThemeController({
  catalog: themeCatalog,
  defaultMode: "system",
  storageKey: "di:theme",
});

/** アプリの外枠（トップバー・サイドバー・注釈）に流し込む色。 */
interface ChromeTokens {
  /** エディタ面。ビューア側の背景 */
  bg: string;
  /** サイドバー面。トップバーとサイドバーの背景 */
  bgRaised: string;
  fg: string;
  fgMuted: string;
  border: string;
  /** ホバー・選択のうっすらした面 */
  accent: string;
  /** 注釈の縦線やチェックボックスなど、差し色 */
  accentLine: string;
  add: string;
  del: string;
}

// 淡色テキストの下限（WCAG AA）。テーマの descriptionForeground をそのまま使えるか判定する
const MIN_MUTED_RATIO = 4.5;
// 枠線が背景に溶ける手前の混合比。ボーダーと区切り線で同じ重さにする
const BORDER_MIX = 22;

const chromeCache = new WeakMap<ThemeLike, ChromeTokens | undefined>();

/**
 * テーマの descriptionForeground が背景に対して読める明るさなら採用する。
 * `#576daf79` のようにアルファ付きの値は背景と合成してから測る。
 */
function readableMuted(bg: string | undefined, candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate === "") return undefined;
  const composited = colorUtils.compositeOverBg(candidate, bg) ?? candidate;
  const compositedLuminance = colorUtils.relativeLuminance(composited);
  const bgLuminance = colorUtils.relativeLuminance(bg);
  // 測れない値（var() や色名）はテーマ作者を信じてそのまま使う
  if (compositedLuminance === null || bgLuminance === null) return candidate;
  return colorUtils.contrastRatio(bgLuminance, compositedLuminance) >= MIN_MUTED_RATIO
    ? candidate
    : undefined;
}

/**
 * Shiki テーマからアプリ側の配色を作る。
 *
 * 前景色は「デザイン上の意図の順」で候補を並べ、背景に対して最も読めるものを選ぶ。
 * 面はすべてその前景色を背景に混ぜて作るので、どのテーマでも破綻しない。
 */
function deriveChrome(theme: ThemeLike): ChromeTokens | undefined {
  const cached = chromeCache.get(theme);
  if (cached !== undefined || chromeCache.has(theme)) return cached;

  const raw = theme.colors ?? {};
  const resolved = normalizeThemeColors(theme).colors ?? {};
  const sidebarBg = resolved["sideBar.background"];
  const fg = colorUtils.pickReadableForeground(sidebarBg, [
    raw["sideBar.foreground"],
    raw["editor.foreground"],
    theme.fg,
  ]);

  // 読める前景色が取れないテーマ（背景しか持たない壊れたテーマ）は諦める
  if (fg === undefined) {
    chromeCache.set(theme, undefined);
    return undefined;
  }

  const base = sidebarBg ?? "transparent";
  const isDark = colorUtils.isDarkSurface(sidebarBg, fg);
  const tokens: ChromeTokens = {
    bg: resolved["editor.background"] ?? base,
    bgRaised: base,
    fg,
    fgMuted:
      readableMuted(sidebarBg, raw["descriptionForeground"]) ??
      colorUtils.deriveMutedFg(fg, sidebarBg),
    border: `color-mix(in srgb, ${fg} ${BORDER_MIX}%, ${base})`,
    accent: `color-mix(in srgb, ${fg} 14%, ${base})`,
    // テーマが持っていればリンク色、無ければフォーカス枠。どちらも無ければ前景色
    accentLine: raw["textLink.foreground"] ?? raw["focusBorder"] ?? fg,
    add: isDark ? "#34d399" : "#047857",
    del: isDark ? "#fb7185" : "#be123c",
  };
  chromeCache.set(theme, tokens);
  return tokens;
}

/** `deriveChrome()` の結果を styles.css が読む CSS 変数へ写す。 */
function chromeStyle(theme: ThemeLike | undefined): CSSProperties {
  if (theme === undefined) return {};
  const chrome = deriveChrome(theme);
  if (chrome === undefined) return {};
  return {
    "--bg": chrome.bg,
    "--bg-raised": chrome.bgRaised,
    "--fg": chrome.fg,
    "--fg-muted": chrome.fgMuted,
    "--border": chrome.border,
    "--accent": chrome.accent,
    "--accent-line": chrome.accentLine,
    "--add": chrome.add,
    "--del": chrome.del,
  } as CSSProperties;
}

/**
 * ファイルツリーの前景色をアプリ側の前景色に揃える。
 *
 * `themeToTreeStyles()` は sideBar.foreground をそのまま使うので、テーマによっては
 * 本文が暗すぎる。テーマが明示していないフォールバックだけ上書きする。
 */
function treeStyle(theme: ThemeLike | undefined): TreeThemeStyles {
  if (theme === undefined) return {};
  const styles = themeToTreeStyles(theme);
  const colors = theme.colors ?? {};
  const fg = deriveChrome(theme)?.fg;
  if (fg === undefined || fg === "" || fg === colors["sideBar.foreground"]) return styles;

  styles.color = fg;
  styles["--trees-theme-sidebar-fg"] = fg;
  if (colors["sideBarSectionHeader.foreground"] === undefined) {
    styles["--trees-theme-sidebar-header-fg"] = fg;
  }
  if (colors["list.activeSelectionForeground"] === undefined) {
    styles["--trees-theme-list-active-selection-fg"] = fg;
  }
  return styles;
}

export interface AppTheme {
  mode: ColorMode;
  scheme: ColorScheme;
  lightThemeName: string;
  darkThemeName: string;
  /** CodeView に渡す明暗のペア。両方渡すとモード切り替えが即座に効く */
  diffTheme: ThemesType;
  themeType: ThemeTypes;
  /** `.app` に流し込む CSS 変数 */
  chromeStyle: CSSProperties;
  treeStyle: TreeThemeStyles;
  setMode(mode: ColorMode): void;
  setThemeName(scheme: ColorScheme, name: string): void;
  themeNames(scheme: ColorScheme): readonly string[];
}

export function useAppTheme(): AppTheme {
  const state = useThemeController(themeController);
  const { resolvedTheme, resolvedColorScheme, lightThemeName, darkThemeName, mode } = state;

  // ルートの color-scheme を合わせておかないと、スクロールバーやフォーム部品、
  // オーバースクロール時に見える下地だけ OS 設定のままになる
  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = resolvedColorScheme;
    return () => {
      root.style.colorScheme = "";
    };
  }, [resolvedColorScheme]);

  // ハイライトはワーカーでやっているので、テーマはワーカー側にも配る必要がある。
  // options 経由で届くのはメインスレッド描画の分だけ
  const workerPool = useWorkerPool();
  useLayoutEffect(() => {
    if (workerPool === undefined) return;
    void workerPool.setRenderOptions({
      theme: { light: lightThemeName, dark: darkThemeName },
    });
  }, [workerPool, lightThemeName, darkThemeName]);

  const style = useMemo(() => chromeStyle(resolvedTheme), [resolvedTheme]);
  const tree = useMemo(() => treeStyle(resolvedTheme), [resolvedTheme]);
  const diffTheme = useMemo<ThemesType>(
    () => ({ light: lightThemeName, dark: darkThemeName }),
    [lightThemeName, darkThemeName],
  );

  return {
    mode,
    scheme: resolvedColorScheme,
    lightThemeName,
    darkThemeName,
    diffTheme,
    themeType: resolvedColorScheme,
    chromeStyle: style,
    treeStyle: tree,
    setMode: (next) => themeController.setColorMode(next),
    setThemeName: (scheme, name) => themeController.setThemeNameForScheme(scheme, name),
    themeNames: (scheme) => themeCatalog.getThemeNames({ colorScheme: scheme }),
  };
}
