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
import { IconDiffSplit, IconDiffUnified, IconRefresh } from "@pierre/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { DiffPayload, StageSection } from "../shared/types.ts";
import { CommentCard, DraftCard } from "./AnnotationCard.tsx";
import type { AnnotationMeta, Comment } from "./comments.ts";
import { CommentPanel } from "./CommentPanel.tsx";
import { FileBrowser } from "./FileBrowser.tsx";
import { CollapseToggle, ViewedToggle } from "./FileHeader.tsx";
import { FileList } from "./FileList.tsx";
import { fileItemId, itemId, pathOfItem, toFileEntry, type FileEntry } from "./fileStats.ts";
import { SettingsMenu } from "./SettingsMenu.tsx";
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

  const options = useMemo(
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

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<AnnotationMeta>) => (
      <CollapseToggle
        collapsed={item.collapsed === true}
        onToggle={() => toggleCollapsed(pathOfItem(item.id))}
      />
    ),
    [toggleCollapsed],
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

  const openFromTree = useCallback((path: string) => setView({ kind: "file", path }), []);

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
            title={live ? "自動更新中" : "切断（再取得ボタンで取り直す）"}
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
        <aside className="sidebar">
          {stagedEntries.length > 0 && (
            <ChangeSection
              title="ステージ済み"
              entries={stagedEntries}
              activePath={activePath}
              isActive={view.kind === "staged"}
              isViewed={review.isViewed}
              onActivate={() => setView({ kind: "staged" })}
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
            activePath={activePath}
            isActive={view.kind === "unstaged"}
            isViewed={review.isViewed}
            onActivate={() => setView({ kind: "unstaged" })}
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
            <FileBrowser list={fileList} onOpen={openFromTree} style={theme.treeStyle} />
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

interface ChangeSectionProps {
  title: string;
  entries: readonly FileEntry[];
  activePath: string | null;
  /** このセクションを本体に出しているか */
  isActive: boolean;
  isViewed(path: string): boolean;
  onActivate(): void;
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
  const { entries } = props;
  const totals = entries.reduce(
    (acc, entry) => ({
      additions: acc.additions + entry.additions,
      deletions: acc.deletions + entry.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const viewed = entries.filter((entry) => props.isViewed(entry.name)).length;

  return (
    <section className={`pane pane--changes${props.isActive ? " is-active" : ""}`}>
      <h2 className="pane__title">
        <button
          type="button"
          className={`pane__reset${props.isActive ? " is-active" : ""}`}
          aria-pressed={props.isActive}
          onClick={props.onActivate}
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
          activePath={props.activePath}
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
  items: CodeViewItem<AnnotationMeta>[];
  options: object;
  renderAnnotation(
    annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>,
  ): ReactNode;
  renderHeaderPrefix(item: CodeViewItem<AnnotationMeta>): ReactNode;
  renderHeaderMetadata(item: CodeViewItem<AnnotationMeta>): ReactNode;
  viewerRef: RefObject<CodeViewHandle<AnnotationMeta> | null>;
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
