#!/usr/bin/env node
//
// Runs a local binary under a Node new enough for the toolchain.
//
// Vite 8 and Vitest 4 sit on Rolldown, which imports `styleText` from `node:util`
// — added in Node 22.12. On anything older the failure is a `SyntaxError` from a
// file deep inside node_modules, which says nothing about the actual problem.
//
// This wrapper runs on whatever Node started it (it uses nothing newer than Node
// 14), checks the version, and re-executes under a newer one if it finds it. So
// `npm run dev` works without anyone having to remember `nvm use` first, and
// without a version number hard-coded anywhere that will rot.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Bumping this needs a matching bump in package.json's `engines`. */
const REQUIRED = [22, 12, 0]

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const [command, ...args] = process.argv.slice(2)
if (!command) {
	console.error('Usage: node scripts/with-node.js <command> [args…]')
	process.exit(64)
}

// npm's shims in .bin are JavaScript with a shebang, which Node runs happily as a
// plain script — so the same path works whichever Node ends up executing it.
const bin = join(ROOT, 'node_modules', '.bin', command)
if (!existsSync(bin)) {
	console.error(`\n  Can't find ${command}. Run \`npm install\` first.\n`)
	process.exit(1)
}

const node = satisfies(process.versions.node) ? process.execPath : findNewerNode()

if (!node) {
	console.error(
		`\n  thumbcinema needs Node ${REQUIRED.join('.')} or newer; this is ${process.versions.node}.\n` +
			`  There's an .nvmrc, so:  nvm use\n` +
			`  Or to stop having to:   nvm alias default 24\n`,
	)
	process.exit(1)
}

if (node !== process.execPath) {
	console.log(`  (using ${versionOf(node)} rather than v${process.versions.node})`)
}

const child = spawn(node, [bin, ...args], { stdio: 'inherit' })

// Forward interrupts so Ctrl-C stops the dev server rather than orphaning it.
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal)
	else process.exit(code ?? 0)
})

function satisfies(version) {
	const parts = String(version).split('.').map(Number)

	for (let i = 0; i < REQUIRED.length; i++) {
		const part = parts[i] ?? 0
		if (part > REQUIRED[i]) return true
		if (part < REQUIRED[i]) return false
	}
	return true
}

function versionOf(executable) {
	const result = spawnSync(executable, ['--version'], { encoding: 'utf8' })
	return result.status === 0 ? result.stdout.trim() : 'unknown'
}

/**
 * The newest installed Node that will do.
 *
 * nvm first, highest version down — that's where a version this old came from, so
 * it's where a newer one will be. Then the usual system locations, which are
 * checked by asking rather than by parsing a path.
 */
function findNewerNode() {
	const nvm = join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'versions', 'node')

	if (existsSync(nvm)) {
		const versions = readdirSync(nvm)
			.filter((name) => name.startsWith('v') && satisfies(name.slice(1)))
			.sort(compareVersions)
			.reverse()

		for (const version of versions) {
			const candidate = join(nvm, version, 'bin', 'node')
			if (existsSync(candidate)) return candidate
		}
	}

	for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
		if (existsSync(candidate) && satisfies(versionOf(candidate).replace(/^v/, ''))) return candidate
	}

	return null
}

function compareVersions(a, b) {
	const left = a.slice(1).split('.').map(Number)
	const right = b.slice(1).split('.').map(Number)

	for (let i = 0; i < 3; i++) {
		if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0)
	}
	return 0
}
