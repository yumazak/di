import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 例外が出たときに真っ白（ダークテーマだと真っ黒）な画面にしないための受け皿。
 *
 * セキュアコンテキスト限定 API のように「手元では動くが http 経由だと落ちる」種類の
 * 不具合は、何も出ないと原因が分からないので、必ず内容を画面に出す。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[di] 描画中にエラーが発生しました", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="crash">
        <h1>エラーが発生しました</h1>
        <pre>{error.message}</pre>
        <button type="button" className="ghost" onClick={() => this.setState({ error: null })}>
          再試行
        </button>
      </div>
    );
  }
}
