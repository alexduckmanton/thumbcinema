#!/usr/bin/env node
//
// Applies db/schema.sql. It is written to be idempotent (IF NOT EXISTS throughout),
// so running it against an existing database is safe and is how you pick up
// schema changes.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/env.js';

loadEnv();

const { query, closePool } = await import('../lib/db.js');

const schema = readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8');

try {
	await query(schema);
	console.log('✓ schema applied');
} catch (err) {
	console.error('✗ migration failed:', err.message);
	process.exitCode = 1;
} finally {
	await closePool();
}
