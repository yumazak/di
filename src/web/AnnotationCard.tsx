import { useEffect, useRef, useState } from "react";
import { formatRef, type Comment } from "./comments.ts";

interface DraftProps {
  onSave(body: string): void;
  onCancel(): void;
}

/** diff の行に差し込まれる入力欄。⌘/Ctrl+Enter で保存、Esc で取り消し。 */
export function DraftCard({ onSave, onCancel }: DraftProps) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function submit(): void {
    const trimmed = body.trim();
    if (trimmed.length > 0) onSave(trimmed);
    else onCancel();
  }

  return (
    <div className="annotation annotation--draft">
      <textarea
        ref={ref}
        className="annotation__input"
        value={body}
        placeholder="コメント（⌘/Ctrl+Enter で保存、Esc で取り消し）"
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="annotation__actions">
        <button type="button" className="ghost" onClick={onCancel}>
          取り消し
        </button>
        <button type="button" className="primary" onClick={submit}>
          保存
        </button>
      </div>
    </div>
  );
}

interface CommentProps {
  comment: Comment;
  onDelete(id: string): void;
}

/** 保存済みコメント。 */
export function CommentCard({ comment, onDelete }: CommentProps) {
  return (
    <div className="annotation">
      <div className="annotation__head">
        <code className="annotation__ref">{formatRef(comment)}</code>
        {/* 削除行の行番号は変更前のファイルのものなので、そうと分かるようにしておく */}
        {comment.side === "deletions" && <span className="annotation__side">変更前の行</span>}
        <button
          type="button"
          className="annotation__delete"
          onClick={() => onDelete(comment.id)}
          aria-label="このコメントを削除"
        >
          ×
        </button>
      </div>
      <p className="annotation__body">{comment.body}</p>
    </div>
  );
}
