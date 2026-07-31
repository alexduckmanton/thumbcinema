import { useEffect } from 'react'

import { CreateButton } from '../components/CreateButton'
import { SiteHeader } from '../components/SiteHeader'
import { Link } from '../router/Router'

export function NotFoundPage() {
	useEffect(() => {
		document.title = 'not found — thumbcinema'
	}, [])

	return (
		<>
			<SiteHeader width="narrow">
				<CreateButton />
			</SiteHeader>

			<main className="center" style={{ padding: '64px 0', textAlign: 'center' }}>
				<h1>There&rsquo;s nothing here.</h1>
				<p>
					Whatever this was, it isn&rsquo;t. <Link to="/">Try the gallery</Link>?
				</p>
			</main>
		</>
	)
}
