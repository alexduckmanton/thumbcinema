import styles from './Spinner.module.css'

export interface SpinnerProps {
	/** Announced to screen readers. Set it to '' inside a control that already says it. */
	label?: string
	className?: string
}

export function Spinner({ label = 'Loading', className }: SpinnerProps) {
	return (
		// The three ARIA attributes below move together. With a label this is a `status`
		// live region, which takes a name; without one it is decorative and gets
		// `aria-hidden` and no name at all. There is no state in which it is an unnamed
		// generic element carrying an `aria-label`, which is what the rule looks for.
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: role and name are set together.
		<span
			className={className ? `${styles.spinner} ${className}` : styles.spinner}
			role={label ? 'status' : undefined}
			aria-label={label || undefined}
			aria-hidden={label ? undefined : true}
		/>
	)
}
