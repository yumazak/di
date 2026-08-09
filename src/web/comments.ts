import type { AnnotationSide } from "@pierre/diffs";

export interface Comment {
  id: string;
  /** リポジトリルートからの相対パス */
  path: string;
  /** additions = 変更後の行番号 / deletions = 変更前の行番号 */
  side: AnnotationSide;
  /** 範囲の終端。注釈はこの行の下に出る（GitHub と同じ） */
  line: number;
  /** 複数行を選んだときの開始行。単一行なら undefined */
  startLine?: number;
  body: string;
  createdAt: string;
}

/** diff 内に差し込む注釈のメタデータ。下書きと保存済みを同じ仕組みで描画する。 */
export type AnnotationMeta =
  | { kind: "comment"; comment: Comment }
  | { kind: "draft"; draft: Draft };

export interface Draft {
  path: string;
  side: AnnotationSide;
  /** 範囲の終端 */
  line: number;
  /** 複数行を選んだときの開始行 */
  startLine?: number;
}

/**
 * コメントの ID。
 *
 * `crypto.randomUUID()` はセキュアコンテキスト限定なので、`http://<LAN or Tailscale IP>`
 * で開いていると未定義になる。`getRandomValues` の方は非セキュアでも使えるのでそちらへ落とす。
 */
function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newComment(draft: Draft, body: string): Comment {
  return {
    id: randomId(),
    path: draft.path,
    side: draft.side,
    line: draft.line,
    ...(draft.startLine !== undefined && draft.startLine !== draft.line
      ? { startLine: draft.startLine }
      : {}),
    body,
    createdAt: new Date().toISOString(),
  };
}

/** クリップボードや UI に出す `パス:行` 表記。複数行なら `パス:開始-終了`。 */
export function formatRef(comment: Comment): string {
  const range =
    comment.startLine !== undefined && comment.startLine !== comment.line
      ? `${comment.startLine}-${comment.line}`
      : `${comment.line}`;
  return `${comment.path}:${range}`;
}

export function sortComments(comments: readonly Comment[]): Comment[] {
  return comments.toSorted(
    (a, b) => a.path.localeCompare(b.path) || (a.startLine ?? a.line) - (b.startLine ?? b.line),
  );
}

/**
 * クリップボード用の書き出し。1 コメント 1 行で `パス:行数 本文`。
 * 本文が複数行のときは 2 行目以降をインデントして、行頭が常に
 * `パス:行数` になるようにしておく。
 */
export function formatComments(comments: readonly Comment[]): string {
  return sortComments(comments)
    .map((comment) => {
      const [first = "", ...rest] = comment.body.trim().split("\n");
      const head = `${formatRef(comment)} ${first}`;
      return rest.length === 0 ? head : [head, ...rest.map((l) => `  ${l}`)].join("\n");
    })
    .join("\n");
}

/**
 * クリップボードへコピーする。
 *
 * Clipboard API はセキュアコンテキスト限定なので、`http://100.x.x.x:7788` のような
 * 素の HTTP でアクセスしているとき（Tailscale 越しのスマホなど）は使えない。
 * その場合は execCommand にフォールバックし、それも駄目なら false を返す。
 */
export async function copyText(text: string): Promise<boolean> {
  if (globalThis.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // フォールバックへ
    }
  }

  // iOS Safari は readonly な要素や select() だけだとコピーできないので、
  // contentEditable にして Range で選択してから execCommand を叩く
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.contentEditable = "true";
  textarea.readOnly = false;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "none";
  textarea.style.opacity = "0";
  document.body.append(textarea);

  try {
    const range = document.createRange();
    range.selectNodeContents(textarea);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

const STORAGE_PREFIX = "di:comments:";

/** コメントはリポジトリごとに localStorage へ置く。ライブリロードや再読み込みで消えないように。 */
export function loadComments(repoRoot: string): Comment[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + repoRoot);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Comment[]) : [];
  } catch {
    return [];
  }
}

export function saveComments(repoRoot: string, comments: readonly Comment[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify(comments));
  } catch {
    // 容量超過やプライベートモードなど。保存できなくても表示は続ける
  }
}
