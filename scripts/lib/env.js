import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads .env into process.env. Node 20 can do this with --env-file, but doing it
 * here means `npm run dev` and the db scripts work the same on Node 20 and 22+
 * without anyone remembering a flag. Existing environment variables always win.
 */
export function loadEnv(file = new URL('../../.env', import.meta.url)) {
	let contents;
	try {
		contents = readFileSync(fileURLToPath(file), 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return;
		throw err;
	}

	for (const line of contents.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;

		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		if (!(key in process.env)) process.env[key] = value;
	}
}
