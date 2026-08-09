import { IconXSquircle } from "@pierre/icons";
import { useMemo, useState } from "react";
import { type Comment, copyText, formatComments, sortComments } from "./comments.ts";

interface Props {
  comments: readonly Comment[];
  onSelect(comment: Comment): void;
  onDelete(id: string): void;
  onClear(): void;
}

type CopyState = "idle" | "copied" | "failed";

/** 範囲コメントなら `12-18`、単一行なら `12`。 */
function lineLabel(comment: Comment): string {
  return comment.startLine !== undefined && comment.startLine !== comment.line
    ? `${comment.startLine}-${comment.line}`
    : `${comment.line}`;
}

/** サイドバーのコメントタブ。ファイルごとにまとめて、まとめてコピーできる。 */
export function CommentPanel({ comments, onSelect, onDelete, onClear }: Props) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const text = formatComments(comments);

  const groups = useMemo(() => {
    const byPath = new Map<string, Comment[]>();
    for (const comment of sortComments(comments)) {
      const list = byPath.get(comment.path);
      if (list) list.push(comment);
      else byPath.set(comment.path, [comment]);
    }
    return [...byPath];
  }, [comments]);

  async function copy(): Promise<void> {
    const ok = await copyText(text);
    setCopyState(ok ? "copied" : "failed");
    if (ok) setTimeout(() => setCopyState("idle"), 1500);
  }

  if (comments.length === 0) {
    return (
      <div className="comments">
        <div className="panel__head">
          <h2 className="panel__title">コメント</h2>
        </div>
        <p className="comments__empty">
          差分の行番号、またはホバーで出る「+」からコメントを追加できます
        </p>
      </div>
    );
  }

  return (
    <div className="comments">
      <div className="panel__head">
        <h2 className="panel__title">コメント</h2>
        <button type="button" className="ghost" onClick={() => void copy()}>
          {copyState === "copied" ? "コピーした" : "コピー"}
        </button>
        <button type="button" className="ghost" onClick={onClear}>
          全削除
        </button>
      </div>

      {copyState === "failed" && (
        // 非セキュアコンテキスト（http でのリモートアクセス）だと自動コピーできない
        <div className="comments__fallback">
          <p>自動コピーできませんでした。以下を選択してコピーしてください。</p>
          <textarea readOnly value={text} rows={6} onFocus={(e) => e.target.select()} />
        </div>
      )}

      <div className="comments__scroll">
        {groups.map(([path, items]) => (
          <section key={path} className="comments__group">
            <h3 className="comments__path" title={path}>
              {path}
            </h3>
            <ul className="comments__list">
              {items.map((comment) => (
                <li key={comment.id} className="comments__item">
                  <button
                    type="button"
                    className="comments__jump"
                    onClick={() => onSelect(comment)}
                  >
                    <code>L{lineLabel(comment)}</code>
                    <span>{comment.body}</span>
                  </button>
                  <button
                    type="button"
                    className="comments__delete"
                    onClick={() => onDelete(comment.id)}
                    aria-label="削除"
                    title="削除"
                  >
                    <IconXSquircle size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
