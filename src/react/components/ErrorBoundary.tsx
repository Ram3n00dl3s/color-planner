import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	public state: State = {
		hasError: false,
		error: null,
	};

	public static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error('[SleekCalendar] Uncaught error:', error, errorInfo);
	}

	public render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}
			return (
				<div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center' }}>
					<p style={{ margin: '0 0 10px 0', fontSize: '13px' }}>An error occurred in this view.</p>
					<button 
						type="button"
						onClick={() => this.setState({ hasError: false, error: null })}
						style={{ 
							cursor: 'pointer', 
							padding: '6px 12px', 
							borderRadius: '6px',
							background: 'var(--interactive-normal)',
							color: 'var(--text-normal)',
							border: '1px solid var(--background-modifier-border)'
						}}
					>
						Recover
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
