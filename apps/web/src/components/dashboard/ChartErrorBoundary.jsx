import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-48 bg-slate-50 rounded-xl border border-slate-200 gap-2 text-slate-500">
          <AlertTriangle size={24} className="text-amber-400" />
          <p className="text-sm font-medium">Chart failed to load</p>
          <p className="text-xs text-slate-400">{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
