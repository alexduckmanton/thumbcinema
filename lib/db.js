import pg from 'pg';

// One pool per process. On Vercel that means one per warm function instance, which
// is why the connection string should point at Neon's pooled (-pooler) endpoint —
// see docs/deployment.md.
let pool;

export function getPool() {
	if (pool) return pool;

	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
	}

	pool = new pg.Pool({
		connectionString,
		// Neon and most hosted Postgres require TLS; a local postgres:// on
		// localhost generally doesn't offer it.
		ssl: isLocal(connectionString) ? false : { rejectUnauthorized: false },
		max: 3,
		idleTimeoutMillis: 10_000,
		connectionTimeoutMillis: 10_000
	});

	pool.on('error', (err) => {
		console.error('[db] idle client error', err);
	});

	return pool;
}

export function query(text, params) {
	return getPool().query(text, params);
}

export async function closePool() {
	if (!pool) return;
	const p = pool;
	pool = undefined;
	await p.end();
}

function isLocal(connectionString) {
	return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
}
