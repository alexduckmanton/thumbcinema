import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '../../components/Button'
import styles from './SaveForm.module.css'

export interface SaveFormValues {
	title: string
	description: string
	nsfw: boolean
}

export interface SaveFormProps {
	saving: boolean
	onSave: (values: SaveFormValues) => void
	onCancel: () => void
}

export function SaveForm({ saving, onSave, onCancel }: SaveFormProps) {
	const titleId = useId()
	const descriptionId = useId()
	const nsfwId = useId()

	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')
	const [nsfw, setNsfw] = useState(false)

	const titleField = useRef<HTMLInputElement | null>(null)
	useEffect(() => {
		titleField.current?.focus()
	}, [])

	return (
		<form
			className={styles.form}
			onSubmit={(event) => {
				event.preventDefault()
				// A title is the only thing required; the browser's own validation
				// says so before this runs.
				if (!title.trim()) return
				onSave({ title: title.trim(), description: description.trim(), nsfw })
			}}
		>
			<fieldset>
				<legend>Almost done&hellip;</legend>

				<ol>
					<li>
						<label htmlFor={titleId}>Title</label>
						<input
							ref={titleField}
							id={titleId}
							type="text"
							autoComplete="off"
							required
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</li>

					<li className={styles.description}>
						<label htmlFor={descriptionId}>
							Description <span className={styles.optional}>(optional)</span>
						</label>
						<textarea
							id={descriptionId}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</li>

					<li className={styles.checkbox}>
						<input
							id={nsfwId}
							type="checkbox"
							checked={nsfw}
							onChange={(event) => setNsfw(event.target.checked)}
						/>
						<label htmlFor={nsfwId} title="Use your best judgement. No harm in getting it wrong.">
							This flipbook contains adult stuff
						</label>
					</li>
				</ol>
			</fieldset>

			<div className={styles.buttons}>
				<Button type="submit" variant="submit" loading={saving}>
					Save flipbook
				</Button>
				<Button variant="blank" onClick={onCancel} disabled={saving}>
					Cancel
				</Button>
			</div>
		</form>
	)
}
