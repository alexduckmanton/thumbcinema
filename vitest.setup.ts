import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
	cleanup()
	window.localStorage.clear()
})

/*
 * jsdom parses `<dialog>` but implements none of its behaviour: `showModal`, `close`
 * and `open` are simply absent, so a component that opens one throws on mount.
 *
 * Stubbed rather than worked around in the component, because the thing being tested is
 * what the dialog *contains* — the fields, the buttons, what comes back on submit — and
 * none of that should have to know it is being rendered somewhere without a top layer.
 * Only the two calls and the flag: this is not an attempt at the real semantics, and a
 * test that needs the backdrop, the focus trap or inertness needs a real browser.
 */
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true
	}
	HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
		this.open = true
	}
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
		this.open = false
		this.dispatchEvent(new Event('close'))
	}
}
