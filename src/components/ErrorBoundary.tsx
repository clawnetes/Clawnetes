import React from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center", maxWidth: "500px", margin: "4rem auto" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#888", marginBottom: "1.5rem" }}>
            The setup wizard encountered an unexpected error. Your progress may need to be re-entered.
          </p>
          {this.state.error && (
            <pre style={{ fontSize: "0.8rem", color: "#c66", textAlign: "left", padding: "1rem", background: "#1a1a1a", borderRadius: "8px", overflow: "auto", marginBottom: "1.5rem" }}>
              {this.state.error.message}
            </pre>
          )}
          <button onClick={this.handleRestart} style={{ padding: "0.6rem 1.5rem" }}>
            Restart Wizard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
