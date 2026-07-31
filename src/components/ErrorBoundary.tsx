import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
	children: ReactNode
	/** Rendered instead of the children once something has thrown. */
	fallback: ReactNode
	onError?: (error: Error) => void
}

interface State {
	failed: boolean
}

/**
 * Catches a render-time throw so the page shows something rather than nothing.
 *
 * React unmounts the whole tree when a component throws and nothing catches it,
 * which is how a single bad frame in the drawing tool turns into a blank page. The
 * create page pairs this with its crash recovery: the boundary is what the reader
 * sees, and the recovery is what saves their work.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
	override state: State = { failed: false }

	static getDerivedStateFromError(): State {
		return { failed: true }
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('[thumbcinema]', error, info.componentStack)
		this.props.onError?.(error)
	}

	override render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children
	}
}
