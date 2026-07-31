import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { Spinner } from './Spinner'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'submit' | 'blank'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
	variant?: ButtonVariant
	/** Swaps the label for a spinner and blocks further presses. */
	loading?: boolean
	children: ReactNode
}

export function Button({
	variant = 'primary',
	loading = false,
	disabled,
	children,
	type = 'button',
	...rest
}: ButtonProps) {
	const classNames = [styles.button, variant !== 'primary' ? styles[variant] : '', loading ? styles.loading : '']
		.filter(Boolean)
		.join(' ')

	return (
		<button type={type} className={classNames} disabled={disabled || loading} aria-busy={loading} {...rest}>
			<span className={styles.label}>{children}</span>
			{loading ? <Spinner className={styles.spinner} label="" /> : null}
		</button>
	)
}

/** Same look, but a real link — used for "New flipbook" and the gallery's retry. */
export const buttonClass = styles.button
