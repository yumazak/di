import { IconSymbolDiffstatFill } from "@pierre/icons";
import { useEffect, useState } from "react";
import { useNarrowViewport } from "./useSettings.ts";

interface Props {
  files: number;
  additions: number;
  deletions: number;
  /** 「表示済み」を付けたファイル数 */
  viewed: number;
}

/** サイドバー最下段の集計。F2 で開閉できる。 */
export function DiffStats({ files, additions, deletions, viewed }: Props) {
  // 狭い画面ではサイドバーの取り分が少ないので、畳んだ状態から始める
  const narrow = useNarrowViewport();
  const [expanded, setExpanded] = useState(() => !narrow);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      setExpanded((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (files === 0) return null;

  return (
    <section className="stats">
      <button
        type="button"
        className="stats__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <IconSymbolDiffstatFill size={14} />
        集計
        <span className="stats__hint">F2</span>
      </button>
      {expanded && (
        <dl className="stats__list">
          <Stat label="ファイル" value={`${files}`} />
          <Stat label="追加" value={`+${additions}`} className="stat-add" />
          <Stat label="削除" value={`−${deletions}`} className="stat-del" />
          <Stat label="表示済み" value={`${viewed}/${files}`} />
        </dl>
      )}
    </section>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="stats__item">
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  );
}
