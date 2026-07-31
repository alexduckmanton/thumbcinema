import styles from './Spinner.module.css'

export interface SpinnerProps {
	/** Announced to screen readers. Set it to '' inside a control that already says it. */
	label?: string
	className?: string
}

export function Spinner({ label = 'Loading', className }: SpinnerProps) {
	return (
		<span
			className={className ? `${styles.spinner} ${className}` : styles.spinner}
			role={label ? 'status' : undefined}
			aria-label={label || undefined}
			aria-hidden={label ? undefined : true}
		/>
	)
}
