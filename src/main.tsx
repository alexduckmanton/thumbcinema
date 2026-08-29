import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { takeRegisteredMessage } from './lib/messages'
import { preventPinchZoom } from './lib/zoom'
import { registerServiceWorker } from './offline/register'
import { startOfflineSync } from './offline/sync'
import './styles/base.css'

// Anything a previous page left for this one — the "your flipbook's saved" banner
// survives the navigation to the flipbook it just created.
takeRegisteredMessage()

// The half of the viewport tag iOS ignores. See lib/zoom.ts.
preventPinchZoom()

// Offline mode, both halves of it: the worker that makes the site openable without a
// connection, and the queue of flipbooks that were saved without one. Both are outside
// React because both are facts about the tab rather than about the page on screen —
// a flipbook queued on the create page goes up while its author is reading the gallery.
// See docs/offline.md.
registerServiceWorker()
startOfflineSync()

const container = document.getElementById('root')
if (!container) throw new Error('No #root to mount into.')

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
