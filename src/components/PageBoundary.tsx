import { Component, type ReactNode } from "react";

export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="page-recovery" role="alert">
        <span className="desk-eyebrow">页面暂时不可用</span>
        <h1>这个页面没有顺利打开</h1>
        <p>请重新载入，或通过左侧导航继续其他工作。</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>重新载入页面</button>
      </section>
    );
  }
}
