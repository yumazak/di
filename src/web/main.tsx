import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import "./fonts.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

/**
 * ハイライトをワーカーに逃がす。メインスレッドでやると、差分が大きいときや
 * スマホで描画が固まる。
 *
 * `langs` は事前ロードのヒントでしかなく、載っていない言語はレンダリング時に
 * 解決される（`WorkerPoolManager.resolveLanguagesAndExecuteTask`）ので指定しない。
 */
const POOL_OPTIONS = {
  poolSize: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2)),
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
};

const HIGHLIGHTER_OPTIONS = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
} as const;

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <WorkerPoolContextProvider
        poolOptions={POOL_OPTIONS}
        highlighterOptions={HIGHLIGHTER_OPTIONS}
      >
        <App />
      </WorkerPoolContextProvider>
    </ErrorBoundary>
  </StrictMode>,
);
