import { Component, type ReactNode } from 'react';

interface Props {
  /** Page name shown in the failure message. */
  name: string;
  /** The boundary clears its error whenever this value changes (the route). */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps a render exception inside one page: the shell and navigation stay usable. */
export class PageBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="notice notice-error" role="alert">
        <div>
          <strong>{this.props.name} stopped working</strong>
          <p>{error.message || 'An unexpected error occurred.'}</p>
        </div>
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}
