import { useState } from "react";
import { type Comment, copyText, formatComments, formatRef, sortComments } from "./comments.ts";

interface Props {
  comments: readonly Comment[];
  onSelect(comment: Comment): void;
  onDelete(id: string): void;
  onClear(): void;
}

type CopyState = "idle" | "copied" | "failed";

/** サイドバー下部のコメント一覧。まとめてクリップボードへコピーできる。 */
export function CommentPanel({ comments, onSelect, onDelete, onClear }: Props) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const text = formatComments(comments);

  async function copy(): Promise<void> {
    const ok = await copyText(text);
    setCopyState(ok ? "copied" : "failed");
    if (ok) setTimeout(() => setCopyState("idle"), 1500);
  }

  if (comments.length === 0) {
    return (
      <section className="comments">
        <h2 className="comments__title">コメント</h2>
        <p className="comments__empty">行番号をクリックすると追加できます</p>
      </section>
    );
  }

  return (
    <section className="comments">
      <h2 className="comments__title">
        コメント <span className="comments__count">{comments.length}</span>
        <span className="comments__actions">
          <button type="button" className="ghost" onClick={() => void copy()}>
            {copyState === "copied" ? "コピーした" : "コピー"}
          </button>
          <button type="button" className="ghost" onClick={onClear}>
            全削除
          </button>
        </span>
      </h2>

      {copyState === "failed" && (
        // 非セキュアコンテキスト（http でのリモートアクセス）だと自動コピーできない
        <div className="comments__fallback">
          <p>自動コピーできませんでした。以下を選択してコピーしてください。</p>
          <textarea readOnly value={text} rows={6} onFocus={(e) => e.target.select()} />
        </div>
      )}

      <ul className="comments__list">
        {sortComments(comments).map((comment) => (
          <li key={comment.id} className="comments__item">
            <button type="button" className="comments__jump" onClick={() => onSelect(comment)}>
              <code>{formatRef(comment)}</code>
              <span>{comment.body}</span>
            </button>
            <button
              type="button"
              className="comments__delete"
              onClick={() => onDelete(comment.id)}
              aria-label="削除"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
