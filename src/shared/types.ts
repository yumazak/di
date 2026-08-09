/** `GET /api/diff` のレスポンス。 */
export interface DiffPayload {
  /** リポジトリのルート（絶対パス） */
  repoRoot: string;
  /** 表示用のリポジトリ名（ルートの basename） */
  repoName: string;
  /** ブランチ名。detached HEAD なら短縮 SHA、コミットが無ければ null */
  branch: string | null;
  /** HEAD の短縮 SHA。コミットが無ければ null */
  head: string | null;
  /** ステージ済みの unified patch（`git diff --cached`）。無ければ空文字 */
  staged: string;
  /** 未ステージの unified patch（`git diff` + 未追跡ファイル）。無ければ空文字 */
  unstaged: string;
  /** 2 本の patch をまとめた内容ハッシュ。キャッシュキーと変更検知に使う */
  hash: string;
  /** 大きすぎる・バイナリなどの理由で patch に含めなかった untracked ファイル */
  skipped: SkippedFile[];
  generatedAt: string;
}

export interface SkippedFile {
  path: string;
  reason: "binary" | "too-large";
}

/** `GET /api/events` (SSE) で飛ぶイベント。 */
export interface ChangeEvent {
  hash: string;
}

/** `GET /api/files` のレスポンス。ファイラ用のパス一覧。 */
export interface FileListPayload {
  /** tracked + untracked（.gitignore は尊重）のパス一覧。ソート済み */
  paths: string[];
  /** 変更のあったファイルの状態。ツリーに印を出すのに使う */
  statuses: FileStatus[];
}

export interface FileStatus {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "untracked";
}

/** `GET /api/file?path=...` のレスポンス。 */
export interface FilePayload {
  path: string;
  contents: string;
  /** バイナリ・サイズ超過で中身を返せなかったとき */
  unavailable?: "binary" | "too-large";
  bytes: number;
}

/** ステージ操作の対象。`git add` / `git restore --staged` に対応する。 */
export type StageSection = "staged" | "unstaged";

/** `POST /api/stage` のリクエスト。 */
export interface StageRequest {
  paths: string[];
  staged: boolean;
}

/** `POST /api/discard` のリクエスト。未ステージの変更を捨てる。 */
export interface DiscardRequest {
  paths: string[];
}
