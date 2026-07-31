import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { takeRegisteredMessage } from './lib/messages'
import './styles/base.css'

// Anything a previous page left for this one — the "your flipbook's saved" banner
// survives the navigation to the flipbook it just created.
takeRegisteredMessage()

const container = document.getElementById('root')
if (!container) throw new Error('No #root to mount into.')

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
