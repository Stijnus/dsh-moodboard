/**
 * serve.mjs — dependency-free static server for the real-render harness.
 *
 * Serves the repository root so index.html can load the REAL client.js (and a
 * frozen snapshot under verification/harness/snapshots) while fixtures and
 * harness modules stay next to index.html.
 *
 *   node verification/harness/serve.mjs [port]
 *
 * Used by capture.mjs, but it also runs standalone for manual poking.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, resolve, sep } from 'node:path'

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0])
  const target = resolve(REPO_ROOT, `.${decoded}`)
  if (target !== REPO_ROOT && !target.startsWith(REPO_ROOT + sep)) return null
  return target
}

export function createHarnessServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      let target = safePath(url.pathname)
      if (target === null) {
        response.writeHead(403, { 'content-type': 'text/plain' })
        response.end('Forbidden')
        return
      }
      let info = await stat(target).catch(() => null)
      if (info !== null && info.isDirectory()) {
        target = resolve(target, 'index.html')
        info = await stat(target).catch(() => null)
      }
      if (info === null || !info.isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('Not found')
        return
      }
      const bytes = await readFile(target)
      response.writeHead(200, {
        'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': bytes.byteLength,
        'cache-control': 'no-store',
      })
      response.end(bytes)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end(`Server error: ${error && error.message ? error.message : error}`)
    }
  })
}

export async function startHarnessServer(port = 4173, host = '127.0.0.1') {
  const server = createHarnessServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolvePromise())
  })
  const address = server.address()
  return { server, url: `http://${host}:${address.port}` }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.argv[2] || '4173', 10)
  const { url } = await startHarnessServer(port)
  console.log(`[harness] serving ${REPO_ROOT}`)
  console.log(`[harness] open ${url}/verification/harness/index.html`)
}
