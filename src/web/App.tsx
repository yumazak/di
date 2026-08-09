import {
  parsePatchFiles,
  type CodeViewItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type LineAnnotation,
  type OnDiffLineClickProps,
  type OnLineClickProps,
  type SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import {
  IconCollapsedRow,
  IconDiffSplit,
  IconDiffUnified,
  IconExpandAll,
  IconRefresh,
} from "@pierre/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DiffPayload, StageSection } from "../shared/types.ts";
import { CommentCard, DraftCard } from "./AnnotationCard.tsx";
import type { AnnotationMeta, Comment } from "./comments.ts";
import { useRepoTree } from "./FileBrowser.tsx";
import { CollapseToggle, ViewedToggle } from "./FileHeader.tsx";
import { fileItemId, itemId, pathOfItem, toFileEntry } from "./fileStats.ts";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { useAppTheme } from "./theme.ts";
import { useComments } from "./useComments.ts";
import { useDiff } from "./useDiff.ts";
import { useFileContents, useFileList, type OpenFile } from "./useFiles.ts";
import { useReviewState } from "./useReviewState.ts";
import { useNarrowViewport, useSettings } from "./useSettings.ts";
import { useStage } from "./useStage.ts";
import { hashStrings, useContentVersions } from "./versions.ts";

/**
 * 本体に何を出すか。
 *
 * ステージ済みと未ステージを同じスクロールに混ぜると、同じファイルが 2 回並んで
 * どちらの差分を見ているのか分からなくなる。VS Code と同じく、見る対象を
 * 「ステージ済み」「変更」「ツリーから開いたファイル」の 3 つに分ける。
 */
type View = { kind: "staged" } | { kind: "unstaged" } | { kind: "file"; path: string };

const CODE_VIEW_STYLE = { height: "100%", overflow: "auto" } as const;
const CODE_VIEW_LAYOUT = { paddingTop: 12, paddingBottom: 48, gap: 12 } as const;

/**
 * 貼り付いたファイルヘッダに下線を出す。スクロールで固定されている間だけ効くので、
 * 一番上のファイルを見ているときに余計な線が出ない。
 */
const CODE_VIEW_CSS = `
[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
}

@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--border);
  }
}
`;

export function App() {
  const { data, error, revision, live, reload, replace } = useDiff();
  const theme = useAppTheme();
  const settings = useSettings();
  const narrow = useNarrowViewport();
  const [view, setView] = useState<View>({ kind: "unstaged" });
  const viewerRef = useRef<CodeViewHandle<AnnotationMeta> | null>(null);

  const repoRoot = data?.repoRoot ?? null;
  const comments = useComments(repoRoot);
  const review = useReviewState(repoRoot);
  const contentVersions = useContentVersions();
  const fileList = useFileList(revision);

  const onStaged = useCallback((payload: DiffPayload) => replace(payload), [replace]);
  const stageApi = useStage(onStaged);

  const openFromTree = useCallback((path: string) => setView({ kind: "file", path }), []);
  const tree = useRepoTree(fileList, openFromTree);

  // patch のハッシュを cacheKey の prefix に使うので、内容が変わらない限り
  // ハイライト結果が使い回される
  const staged = useMemo(
    () =>
      data?.staged ? parsePatchFiles(data.staged, `${data.hash}:s`).flatMap((p) => p.files) : [],
    [data?.staged, data?.hash],
  );
  const unstaged = useMemo(
    () =>
      data?.unstaged
        ? parsePatchFiles(data.unstaged, `${data.hash}:u`).flatMap((p) => p.files)
        : [],
    [data?.unstaged, data?.hash],
  );

  const stagedByPath = useMemo(() => new Map(staged.map((f) => [f.name, f])), [staged]);
  const unstagedByPath = useMemo(() => new Map(unstaged.map((f) => [f.name, f])), [unstaged]);

  const stagedEntries = useMemo(() => staged.map((f) => toFileEntry("staged", f)), [staged]);
  const unstagedEntries = useMemo(
    () => unstaged.map((f) => toFileEntry("unstaged", f)),
    [unstaged],
  );

  // 見ているセクションが空になったら、中身のある方へ移る。空の画面を見せないため
  useEffect(() => {
    setView((current) => {
      if (current.kind === "staged" && staged.length === 0) return { kind: "unstaged" };
      if (current.kind === "unstaged" && unstaged.length === 0 && staged.length > 0) {
        return { kind: "staged" };
      }
      return current;
    });
  }, [staged.length, unstaged.length]);

  // ツリーから開いたファイルは、変更があっても差分ではなく中身そのものを出す。
  // 差分を見る場所は「ステージ済み」「変更」の 2 つに寄せてある
  const openFile = useFileContents(view.kind === "file" ? view.path : null, revision);

  const buildDiffItem = useCallback(
    (section: StageSection, file: FileDiffMetadata): CodeViewItem<AnnotationMeta> => ({
      id: itemId(section, file.name),
      type: "diff" as const,
      fileDiff: file,
      annotations: comments.annotationsFor(file.name),
      collapsed: review.isCollapsed(file.name),
      // 中身・注釈・折りたたみのどれかが変わったファイルだけ version が動く
      version:
        contentVersions.versionOf(
          `${section}:${file.name}`,
          hashStrings([file.name, ...file.deletionLines, ...file.additionLines]),
        ) +
        comments.annotationVersion(file.name) +
        review.version(file.name),
    }),
    [comments, contentVersions, review],
  );

  const items = useMemo<CodeViewItem<AnnotationMeta>[]>(() => {
    if (view.kind === "staged") return staged.map((f) => buildDiffItem("staged", f));
    if (view.kind === "unstaged") return unstaged.map((f) => buildDiffItem("unstaged", f));

    const payload = openFile.payload;
    if (payload === null || payload.unavailable !== undefined) return [];

    // metadata は判別可能ユニオンなので、分岐ごとに組み直さないと型が合わない
    const annotations: LineAnnotation<AnnotationMeta>[] = (
      comments.annotationsFor(payload.path) ?? []
    )
      .filter((annotation) => annotation.side === "additions")
      .map(({ lineNumber, metadata }) =>
        metadata.kind === "comment" ? { lineNumber, metadata } : { lineNumber, metadata },
      );

    return [
      {
        id: fileItemId(payload.path),
        type: "file" as const,
        file: { name: payload.path, contents: payload.contents },
        annotations,
        version:
          contentVersions.versionOf(
            `file:${payload.path}`,
            hashStrings([payload.path, payload.contents]),
          ) + comments.annotationVersion(payload.path),
      },
    ];
  }, [view, staged, unstaged, openFile.payload, buildDiffItem, comments, contentVersions]);

  const { openDraft } = comments;
  const { toggleCollapsed, toggleViewed } = review;

  const options = useMemo<CodeViewOptions<AnnotationMeta>>(
    () => ({
      theme: theme.diffTheme,
      themeType: theme.themeType,
      // 狭い画面では 2 カラムがまともに読めないので、設定に関わらず 1 カラムにする
      diffStyle: narrow ? "unified" : settings.diffStyle,
      overflow: settings.wordWrap ? "wrap" : "scroll",
      diffIndicators: settings.diffIndicators,
      disableBackground: !settings.backgrounds,
      disableLineNumbers: !settings.lineNumbers,
      stickyHeaders: true,
      // 行番号の上だけハイライトする。行全体が光ると差分の色と喧嘩する
      lineHoverHighlight: "number",
      // ドラッグで行範囲を選べるようにする。コメントの対象範囲がその場で見える
      enableLineSelection: true,
      // ガターの「+」。クリックで 1 行、ドラッグで範囲を選んでコメントできる。
      // 見た目はライブラリ側が出す（renderGutterUtility との併用は禁止されている）
      enableGutterUtility: true,
      unsafeCSS: CODE_VIEW_CSS,
      layout: CODE_VIEW_LAYOUT,
      onGutterUtilityClick(range: SelectedLineRange, context: { item: { id: string } }) {
        openDraft({
          path: pathOfItem(context.item.id),
          side: range.endSide ?? range.side ?? "additions",
          line: range.end,
          startLine: range.start,
        });
      },
      // タッチ環境ではホバーで「+」が出ないので、行番号クリックでも開けるようにしておく
      onLineNumberClick(
        props: OnLineClickProps | OnDiffLineClickProps,
        context: { item: { id: string } },
      ) {
        // file アイテムには side が無いので、現在のファイルの行＝additions とみなす
        const side = "annotationSide" in props ? props.annotationSide : "additions";
        openDraft({ path: pathOfItem(context.item.id), side, line: props.lineNumber });
      },
    }),
    [
      narrow,
      theme.diffTheme,
      theme.themeType,
      settings.diffStyle,
      settings.wordWrap,
      settings.diffIndicators,
      settings.backgrounds,
      settings.lineNumbers,
      openDraft,
    ],
  );

  /**
   * 折りたたみ。畳んだファイルが画面の上に出ていると、その分だけ下の内容がせり上がって
   * 目で追っていた位置を見失う。畳む前に上にあったなら、そのファイルの頭へ寄せ直す。
   */
  const toggleCollapsedAnchored = useCallback(
    (id: string) => {
      const viewer = viewerRef.current?.getInstance();
      const itemTop = viewer?.getTopForItem(id);
      const scrollTop = viewer?.getScrollTop();
      toggleCollapsed(pathOfItem(id));
      if (itemTop === undefined || scrollTop === undefined || itemTop >= scrollTop) return;
      requestAnimationFrame(() =>
        viewerRef.current?.scrollTo({ type: "item", id, align: "start" }),
      );
    },
    [toggleCollapsed],
  );

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<AnnotationMeta>) => (
      <CollapseToggle
        collapsed={item.collapsed === true}
        onToggle={() => toggleCollapsedAnchored(item.id)}
      />
    ),
    [toggleCollapsedAnchored],
  );

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<AnnotationMeta>) => {
      if (item.type !== "diff") return null;
      const path = pathOfItem(item.id);
      return <ViewedToggle viewed={review.isViewed(path)} onToggle={() => toggleViewed(path)} />;
    },
    [review, toggleViewed],
  );

  const allPaths = useMemo(
    () => [...new Set([...staged.map((f) => f.name), ...unstaged.map((f) => f.name)])],
    [staged, unstaged],
  );
  const allCollapsed = allPaths.length > 0 && allPaths.every(review.isCollapsed);

  /**
   * 目的の差分が別のセクションにあるなら切り替えてからスクロールする。
   * 表示を切り替えるとアイテムが総入れ替えになるので、描画後まで待つ必要がある。
   */
  const showAndScroll = useCallback(
    (next: View, scroll: () => void) => {
      if (view.kind === next.kind) {
        scroll();
        return;
      }
      setView(next);
      requestAnimationFrame(scroll);
    },
    [view.kind],
  );

  /** 変更一覧から選ぶ。そのセクションの表示に切り替えて、該当ファイルまでスクロールする。 */
  const selectDiff = useCallback(
    (section: StageSection, path: string) => {
      const id = itemId(section, path);
      showAndScroll({ kind: section }, () =>
        viewerRef.current?.scrollTo({ type: "item", id, align: "start" }),
      );
    },
    [showAndScroll],
  );

  const scrollToComment = useCallback(
    (comment: Comment) => {
      // 同じパスが両方にあるときは未ステージ側を優先する（作業中の内容だから）
      const section: StageSection | null = unstagedByPath.has(comment.path)
        ? "unstaged"
        : stagedByPath.has(comment.path)
          ? "staged"
          : null;
      const next: View =
        section === null ? { kind: "file", path: comment.path } : { kind: section };
      const id = section === null ? fileItemId(comment.path) : itemId(section, comment.path);
      showAndScroll(next, () =>
        viewerRef.current?.scrollTo({
          type: "line",
          id,
          lineNumber: comment.line,
          side: comment.side,
          align: "center",
        }),
      );
    },
    [stagedByPath, unstagedByPath, showAndScroll],
  );

  /** 破棄は取り消せないので必ず確認を挟む。VS Code も同じ。 */
  const confirmDiscard = useCallback(
    (paths: readonly string[]) => {
      const target = paths.length === 1 ? paths[0] : `${paths.length} ファイル`;
      const ok = globalThis.confirm(
        `${target} の未ステージの変更を破棄します。\n\nこの操作は取り消せません。`,
      );
      if (ok) stageApi.discard(paths);
    },
    [stageApi],
  );

  // 下書きの内容は注釈の metadata から取る。クロージャで draft を掴むと、
  // 下書きを開閉するたびに renderAnnotation の identity が変わって全アイテムが
  // 作り直されてしまう
  const { add, remove, closeDraft } = comments;
  const renderAnnotation = useCallback(
    (annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>) => {
      if (annotation.metadata.kind === "comment") {
        return <CommentCard comment={annotation.metadata.comment} onDelete={remove} />;
      }
      const target = annotation.metadata.draft;
      return <DraftCard onSave={(body) => add(target, body)} onCancel={closeDraft} />;
    },
    [add, remove, closeDraft],
  );

  // ツリーから開いたファイルは、変更一覧側でもその行を光らせる
  const activePath = view.kind === "file" ? view.path : null;
  const { setAllCollapsed } = review;

  // 差分と関係ないところ（ツリー・コメント）にフォーカスがあっても効いてほしいので
  // window で拾う。入力中は邪魔になるので、フォーム部品の上では無視する
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // target が document / window のことがあるので、要素だと確かめてから辿る
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]")) {
        return;
      }

      if (event.key === "d") {
        event.preventDefault();
        settings.set("diffStyle", settings.diffStyle === "split" ? "unified" : "split");
        return;
      }
      if (event.key === "c" && allPaths.length > 0) {
        event.preventDefault();
        setAllCollapsed(allPaths, !allCollapsed);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings, allPaths, allCollapsed, setAllCollapsed]);

  return (
    <div className="app" style={theme.chromeStyle}>
      <header className="topbar">
        <div className="topbar__title">
          <strong>{data?.repoName ?? "…"}</strong>
          {data?.branch && <span className="topbar__branch">{data.branch}</span>}
          {data?.head && <span className="topbar__sha">{data.head}</span>}
          <span
            className={`live${live ? " is-on" : ""}`}
            title={live ? "自動更新中" : "切断（reload で再取得）"}
            aria-label={live ? "自動更新中" : "切断"}
          />
        </div>

        {/* いま何の差分を見ているのかを常に出す。セクションごとに画面が分かれるので、
            サイドバーを見なくても分かるようにしておく */}
        <div className="topbar__summary">
          {view.kind === "file" ? (
            <code>{view.path}</code>
          ) : (
            <span>{view.kind === "staged" ? "ステージ済みの差分" : "未ステージの差分"}</span>
          )}
        </div>

        <div className="topbar__actions">
          {view.kind !== "file" && !narrow && (
            <button
              type="button"
              className="icon-button"
              title={
                settings.diffStyle === "split" ? "1 カラム表示にする (d)" : "2 カラム表示にする (d)"
              }
              aria-label="表示レイアウトを切り替える"
              onClick={() =>
                settings.set("diffStyle", settings.diffStyle === "split" ? "unified" : "split")
              }
            >
              {settings.diffStyle === "split" ? (
                <IconDiffSplit size={14} />
              ) : (
                <IconDiffUnified size={14} />
              )}
            </button>
          )}
          {/* ビューアに出ている各ファイルの差分を一括で折りたたむ。
              サイドバーのセクションの開閉とは別物なので、置き場所も分けてある */}
          {view.kind !== "file" && allPaths.length > 0 && (
            <button
              type="button"
              className="icon-button"
              aria-pressed={allCollapsed}
              title={allCollapsed ? "差分をすべて開く (c)" : "差分をすべてたたむ (c)"}
              onClick={() => setAllCollapsed(allPaths, !allCollapsed)}
            >
              {allCollapsed ? <IconCollapsedRow size={14} /> : <IconExpandAll size={14} />}
            </button>
          )}
          <button type="button" className="icon-button" onClick={reload} title="差分を取り直す">
            <IconRefresh size={14} />
          </button>
          <SettingsMenu theme={theme} settings={settings} />
        </div>
      </header>

      {error !== null && <div className="banner banner--error">{error}</div>}
      {stageApi.error !== null && <div className="banner banner--error">{stageApi.error}</div>}

      {data !== null && data.skipped.length > 0 && (
        <div className="banner">
          表示していない未追跡ファイル:{" "}
          {data.skipped
            .map(
              (file) => `${file.path}（${file.reason === "binary" ? "バイナリ" : "サイズ超過"}）`,
            )
            .join(", ")}
        </div>
      )}

      <div className="body">
        <Sidebar
          stagedEntries={stagedEntries}
          unstagedEntries={unstagedEntries}
          activePath={activePath}
          activeSection={view.kind === "file" ? null : view.kind}
          isViewed={review.isViewed}
          view={settings.sidebarView}
          open={settings.sidebarOpen}
          onViewChange={(next, open) => {
            settings.set("sidebarView", next);
            settings.set("sidebarOpen", open);
          }}
          onSelectSection={(section) => setView({ kind: section })}
          onSelect={selectDiff}
          onStage={stageApi.stage}
          onDiscard={confirmDiscard}
          stagePending={stageApi.pending}
          changedCount={allPaths.length}
          tree={tree}
          treeStyle={theme.treeStyle}
          comments={comments.comments}
          onSelectComment={scrollToComment}
          onDeleteComment={remove}
          onClearComments={comments.clear}
          viewedCount={allPaths.filter(review.isViewed).length}
        />

        <main className="viewer">
          <Viewer
            items={items}
            options={options}
            renderAnnotation={renderAnnotation}
            renderHeaderPrefix={renderHeaderPrefix}
            renderHeaderMetadata={renderHeaderMetadata}
            viewerRef={viewerRef}
            repoRoot={repoRoot}
            view={view}
            openFile={openFile}
          />
        </main>
      </div>
    </div>
  );
}

interface ViewerProps {
  items: CodeViewItem<AnnotationMeta>[];
  options: CodeViewOptions<AnnotationMeta>;
  renderAnnotation(
    annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>,
  ): ReactNode;
  renderHeaderPrefix(item: CodeViewItem<AnnotationMeta>): ReactNode;
  renderHeaderMetadata(item: CodeViewItem<AnnotationMeta>): ReactNode;
  viewerRef: React.RefObject<CodeViewHandle<AnnotationMeta> | null>;
  repoRoot: string | null;
  view: View;
  openFile: OpenFile;
}

/** 表示する中身がないケースを先に片付けて、あとは CodeView に任せる。 */
function Viewer({
  items,
  options,
  renderAnnotation,
  renderHeaderPrefix,
  renderHeaderMetadata,
  viewerRef,
  repoRoot,
  view,
  openFile,
}: ViewerProps) {
  if (view.kind === "file") {
    if (openFile.loading) return <div className="empty">読み込み中…</div>;
    if (openFile.error !== null) return <div className="empty">{openFile.error}</div>;

    const unavailable = openFile.payload?.unavailable;
    if (unavailable !== undefined) {
      return (
        <div className="empty">
          <p>{unavailable === "binary" ? "バイナリファイルです" : "ファイルが大きすぎます"}</p>
          <code>{view.path}</code>
        </div>
      );
    }
  } else if (items.length === 0) {
    return (
      <div className="empty">
        <p>
          {view.kind === "staged"
            ? "ステージ済みの変更はありません"
            : "未ステージの変更はありません"}
        </p>
        <p className="empty__hint">左の「ファイル」から任意のファイルを開けます</p>
        {repoRoot !== null && <code>{repoRoot}</code>}
      </div>
    );
  }

  return (
    <CodeView
      ref={viewerRef}
      items={items}
      options={options}
      renderAnnotation={renderAnnotation}
      renderHeaderPrefix={renderHeaderPrefix}
      renderHeaderMetadata={renderHeaderMetadata}
      style={CODE_VIEW_STYLE}
    />
  );
}
