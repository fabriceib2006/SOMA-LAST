import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SOMA ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6 text-neutral-900">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-neutral-200 shadow-xl space-y-6 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto border border-red-100">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-neutral-900">
                {this.props.fallbackTitle || 'SOMA Session Recovery'}
              </h2>
              <p className="text-xs text-neutral-500 leading-relaxed">
                An unexpected view error occurred while rendering. SOMA Intelligence has isolated the failure to protect your academic data.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 bg-neutral-100 rounded-xl text-left text-xs font-mono text-neutral-700 overflow-x-auto max-h-32 border border-neutral-200">
                {this.state.error.message}
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-sm cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reload SOMA</span>
              </button>
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>Home Dashboard</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
