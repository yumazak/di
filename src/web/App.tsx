import {
  parsePatchFiles,
  type CodeViewItem,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type LineAnnotation,
  type OnDiffLineClickProps,
  type OnLineClickProps,
  type SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { DiffPayload, StageSection } from "../shared/types.ts";
import { CommentCard, DraftCard } from "./AnnotationCard.tsx";
import type { AnnotationMeta, Comment } from "./comments.ts";
import { CommentPanel } from "./CommentPanel.tsx";
import { FileBrowser } from "./FileBrowser.tsx";
import { CollapseToggle, SectionBadge, ViewedToggle } from "./FileHeader.tsx";
import { FileList } from "./FileList.tsx";
import { fileItemId, itemId, pathOfItem, toFileEntry, type FileEntry } from "./fileStats.ts";
import { useComments } from "./useComments.ts";
import { useDiff } from "./useDiff.ts";
import { useFileContents, useFileList, type OpenFile } from "./useFiles.ts";
import { useReviewState } from "./useReviewState.ts";
import { useStage } from "./useStage.ts";
import { hashStrings, useContentVersions } from "./versions.ts";

type Layout = "split" | "unified";

/** null なら全部まとめて表示。 */
type Selection =
  | { kind: "diff"; section: StageSection; path: string }
  | { kind: "file"; path: string }
  | null;

const CODE_VIEW_STYLE = { height: "100%", overflow: "auto" } as const;

export function App() {
  const { data, error, revision, live, reload, replace } = useDiff();
  const [layout, setLayout] = useState<Layout>("split");
  const [selection, setSelection] = useState<Selection>(null);
  const viewerRef = useRef<CodeViewHandle<AnnotationMeta> | null>(null);

  const repoRoot = data?.repoRoot ?? null;
  const comments = useComments(repoRoot);
  const review = useReviewState(repoRoot);
  const contentVersions = useContentVersions();
  const fileList = useFileList(revision);

  const onStaged = useCallback((payload: DiffPayload) => replace(payload), [replace]);
  const stageApi = useStage(onStaged);

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

  // 変更のあるファイルは patch から中身が取れるので、取りに行くのは変更のないファイルだけ
  const needsContents =
    selection?.kind === "file" &&
    !unstagedByPath.has(selection.path) &&
    !stagedByPath.has(selection.path);
  const openFile = useFileContents(needsContents ? selection.path : null, revision);

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
    if (selection === null) {
      return [
        ...staged.map((f) => buildDiffItem("staged", f)),
        ...unstaged.map((f) => buildDiffItem("unstaged", f)),
      ];
    }

    if (selection.kind === "diff") {
      const source = selection.section === "staged" ? stagedByPath : unstagedByPath;
      const file = source.get(selection.path);
      return file ? [buildDiffItem(selection.section, file)] : [];
    }

    // ツリーから開いたファイル。変更があるならその差分を優先して見せる
    const unstagedFile = unstagedByPath.get(selection.path);
    if (unstagedFile) return [buildDiffItem("unstaged", unstagedFile)];
    const stagedFile = stagedByPath.get(selection.path);
    if (stagedFile) return [buildDiffItem("staged", stagedFile)];

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
  }, [
    selection,
    staged,
    unstaged,
    stagedByPath,
    unstagedByPath,
    openFile.payload,
    buildDiffItem,
    comments,
    contentVersions,
  ]);

  const { openDraft } = comments;
  const { toggleCollapsed, toggleViewed } = review;

  const options = useMemo(
    () => ({
      diffStyle: layout,
      stickyHeaders: true,
      // ガターの「+」。クリックで 1 行、ドラッグで範囲を選んでコメントできる。
      // 見た目はライブラリ側が出す（renderGutterUtility との併用は禁止されている）
      enableGutterUtility: true,
      layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
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
    [layout, openDraft],
  );

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<AnnotationMeta>) => (
      <CollapseToggle
        collapsed={item.collapsed === true}
        onToggle={() => toggleCollapsed(pathOfItem(item.id))}
      />
    ),
    [toggleCollapsed],
  );

  // まとめ表示では staged と unstaged が並ぶので、ヘッダで区別できるようにする
  const renderHeaderFilenameSuffix = useCallback(
    (item: CodeViewItem<AnnotationMeta>) =>
      item.id.startsWith("staged:") ? <SectionBadge /> : null,
    [],
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

  /** 変更一覧から選ぶ。まとめ表示に戻したうえで、その差分までスクロールする。 */
  function selectDiff(section: StageSection, path: string): void {
    const id = itemId(section, path);
    if (selection === null) {
      viewerRef.current?.scrollTo({ type: "item", id, align: "start" });
      return;
    }
    setSelection(null);
    requestAnimationFrame(() => viewerRef.current?.scrollTo({ type: "item", id, align: "start" }));
  }

  function scrollToComment(comment: Comment): void {
    const inUnstaged = unstagedByPath.has(comment.path);
    const id =
      inUnstaged || stagedByPath.has(comment.path)
        ? itemId(inUnstaged ? "unstaged" : "staged", comment.path)
        : fileItemId(comment.path);
    viewerRef.current?.scrollTo({
      type: "line",
      id,
      lineNumber: comment.line,
      side: comment.side,
      align: "center",
    });
  }

  const openFromTree = useCallback((path: string) => setSelection({ kind: "file", path }), []);

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

  const activeId = selection?.kind === "diff" ? itemId(selection.section, selection.path) : null;
  const openPath = selection === null ? null : selection.path;
  const isFileOnly = needsContents === true;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <strong>{data?.repoName ?? "…"}</strong>
          {data?.branch && <span className="topbar__branch">{data.branch}</span>}
          {data?.head && <span className="topbar__sha">{data.head}</span>}
        </div>

        <div className="topbar__summary">{openPath !== null && <code>{openPath}</code>}</div>

        <div className="topbar__actions">
          {!isFileOnly && (
            <div className="segmented" role="group" aria-label="レイアウト">
              {(["split", "unified"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={layout === value ? "is-active" : ""}
                  onClick={() => setLayout(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="ghost" onClick={reload}>
            reload
          </button>
          <span className={`live${live ? " is-on" : ""}`} title={live ? "自動更新中" : "切断"}>
            ●
          </span>
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
        <aside className="sidebar">
          {stagedEntries.length > 0 && (
            <ChangeSection
              title="ステージ済み"
              entries={stagedEntries}
              activeId={activeId}
              isAllView={selection === null}
              isViewed={review.isViewed}
              onReset={() => setSelection(null)}
              onSelect={(path) => selectDiff("staged", path)}
              stageLabel="−"
              bulkLabel="すべて解除"
              disabled={stageApi.pending}
              onStage={(paths) => stageApi.stage(paths, false)}
            />
          )}

          <ChangeSection
            title="変更"
            entries={unstagedEntries}
            activeId={activeId}
            isAllView={selection === null}
            isViewed={review.isViewed}
            onReset={() => setSelection(null)}
            onSelect={(path) => selectDiff("unstaged", path)}
            stageLabel="+"
            bulkLabel="すべてステージ"
            disabled={stageApi.pending}
            onStage={(paths) => stageApi.stage(paths, true)}
            onDiscard={confirmDiscard}
            extra={
              allPaths.length > 0 ? (
                <button
                  type="button"
                  className="pane__action"
                  onClick={() => review.setAllCollapsed(allPaths, !allCollapsed)}
                >
                  {allCollapsed ? "全部開く" : "全部たたむ"}
                </button>
              ) : null
            }
          />

          <section className="pane pane--tree">
            <h2 className="pane__title">ファイル</h2>
            <FileBrowser list={fileList} onOpen={openFromTree} />
          </section>

          <CommentPanel
            comments={comments.comments}
            onSelect={scrollToComment}
            onDelete={remove}
            onClear={comments.clear}
          />
        </aside>

        <main className="viewer">
          <Viewer
            layout={layout}
            items={items}
            options={options}
            renderAnnotation={renderAnnotation}
            renderHeaderPrefix={renderHeaderPrefix}
            renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
            renderHeaderMetadata={renderHeaderMetadata}
            viewerRef={viewerRef}
            repoRoot={repoRoot}
            openPath={openPath}
            openFile={openFile}
            isFileOnly={isFileOnly}
            hasChanges={allPaths.length > 0}
          />
        </main>
      </div>
    </div>
  );
}

interface ChangeSectionProps {
  title: string;
  entries: readonly FileEntry[];
  activeId: string | null;
  isAllView: boolean;
  isViewed(path: string): boolean;
  onReset(): void;
  onSelect(path: string): void;
  stageLabel: string;
  bulkLabel: string;
  disabled: boolean;
  onStage(paths: readonly string[]): void;
  /** 未ステージのセクションだけ渡す。渡すと破棄の導線が出る */
  onDiscard?: (paths: readonly string[]) => void;
  extra?: ReactNode;
}

/** サイドバーの「ステージ済み」「変更」セクション。 */
function ChangeSection(props: ChangeSectionProps) {
  const { entries, isAllView } = props;
  const totals = entries.reduce(
    (acc, entry) => ({
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const viewed = entries.filter((entry) => props.isViewed(entry.name)).length;

  return (
    <section className="pane pane--changes">
      <h2 className="pane__title">
        <button
          type="button"
          className={`pane__reset${isAllView ? " is-active" : ""}`}
          onClick={props.onReset}
          disabled={entries.length === 0}
        >
          {props.title}
        </button>
        {entries.length > 0 && (
          <>
            <span className="pane__count">
              {viewed > 0 ? `${viewed}/${entries.length}` : entries.length}
            </span>
            <span className="pane__stats">
              {props.extra}
              {props.onDiscard && (
                <button
                  type="button"
                  className="pane__action pane__action--danger"
                  disabled={props.disabled}
                  onClick={() => props.onDiscard?.(entries.map((entry) => entry.name))}
                >
                  すべて破棄
                </button>
              )}
              <button
                type="button"
                className="pane__action"
                disabled={props.disabled}
                onClick={() => props.onStage(entries.map((entry) => entry.name))}
              >
                {props.bulkLabel}
              </button>
              <span className="stat-add">+{totals.additions}</span>
              <span className="stat-del">−{totals.deletions}</span>
            </span>
          </>
        )}
      </h2>
      {entries.length === 0 ? (
        <p className="pane__empty">変更なし</p>
      ) : (
        <FileList
          files={entries}
          activeId={props.activeId}
          isViewed={props.isViewed}
          onSelect={props.onSelect}
          stageLabel={props.stageLabel}
          stageDisabled={props.disabled}
          onStage={(path) => props.onStage([path])}
          onDiscard={props.onDiscard && ((path: string) => props.onDiscard?.([path]))}
        />
      )}
    </section>
  );
}

interface ViewerProps {
  layout: Layout;
  items: CodeViewItem<AnnotationMeta>[];
  options: object;
  renderAnnotation(
    annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>,
  ): ReactNode;
  renderHeaderPrefix(item: CodeViewItem<AnnotationMeta>): ReactNode;
  renderHeaderFilenameSuffix(item: CodeViewItem<AnnotationMeta>): ReactNode;
  renderHeaderMetadata(item: CodeViewItem<AnnotationMeta>): ReactNode;
  viewerRef: RefObject<CodeViewHandle<AnnotationMeta> | null>;
  repoRoot: string | null;
  openPath: string | null;
  openFile: OpenFile;
  isFileOnly: boolean;
  hasChanges: boolean;
}

/** 表示する中身がないケースを先に片付けて、あとは CodeView に任せる。 */
function Viewer({
  layout,
  items,
  options,
  renderAnnotation,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  viewerRef,
  repoRoot,
  openPath,
  openFile,
  isFileOnly,
  hasChanges,
}: ViewerProps) {
  if (openPath === null && !hasChanges) {
    return (
      <div className="empty">
        <p>コミットしていない変更はありません</p>
        <p className="empty__hint">左の「ファイル」から任意のファイルを開けます</p>
        {repoRoot !== null && <code>{repoRoot}</code>}
      </div>
    );
  }

  if (isFileOnly) {
    if (openFile.loading) return <div className="empty">読み込み中…</div>;
    if (openFile.error !== null) return <div className="empty">{openFile.error}</div>;

    const unavailable = openFile.payload?.unavailable;
    if (unavailable !== undefined) {
      return (
        <div className="empty">
          <p>{unavailable === "binary" ? "バイナリファイルです" : "ファイルが大きすぎます"}</p>
          <code>{openPath}</code>
        </div>
      );
    }
  }

  return (
    <CodeView
      key={layout}
      ref={viewerRef}
      items={items}
      options={options}
      renderAnnotation={renderAnnotation}
      renderHeaderPrefix={renderHeaderPrefix}
      renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
      renderHeaderMetadata={renderHeaderMetadata}
      style={CODE_VIEW_STYLE}
    />
  );
}
