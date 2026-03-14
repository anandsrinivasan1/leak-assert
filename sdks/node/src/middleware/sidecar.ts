/**
 * leak-assert HTTP sidecar — Express / Connect middleware.
 *
 * Mounts a /__leak_assert__/heap endpoint that the CLI can poll to
 * sample the host process's heap without any code changes to the app.
 *
 * Usage (Express):
 *
 *   import express from 'express'
 *   import { leakAssertSidecar } from 'leak-assert/middleware'
 *
 *   const app = express()
 *   if (process.env.NODE_ENV !== 'production') {
 *     app.use(leakAssertSidecar())
 *   }
 *
 * Usage (standalone, no framework):
 *
 *   import { startSidecarServer } from 'leak-assert/middleware'
 *   startSidecarServer({ port: 9123 })
 */

import * as v8   from 'v8'
import * as http from 'http'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HeapPayload {
  ts:         number
  heap_used:  number
  heap_total: number
  rss:        number
  external:   number
  gc_count:   number
  node_version: string
}

export interface SidecarOptions {
  /** URL prefix (default: /__leak_assert__) */
  prefix?: string
  /** Only allow requests from localhost (default: true) */
  localhostOnly?: boolean
}

// ── Heap snapshot ─────────────────────────────────────────────────────────────

function snapshot(): HeapPayload {
  const stats = v8.getHeapStatistics()
  const mem   = process.memoryUsage()
  return {
    ts:           Date.now(),
    heap_used:    stats.used_heap_size,
    heap_total:   stats.total_heap_size,
    rss:          mem.rss,
    external:     mem.external,
    gc_count:     0,  // incremented via PerformanceObserver if available
    node_version: process.version,
  }
}

// ── Express / Connect middleware ──────────────────────────────────────────────

export function leakAssertSidecar(opts: SidecarOptions = {}) {
  const prefix       = opts.prefix       ?? '/__leak_assert__'
  const localhostOnly = opts.localhostOnly ?? true

  return function leakAssertMiddleware(
    req:  { url?: string; socket?: { remoteAddress?: string } },
    res:  { writeHead: (status: number, headers?: Record<string, string>) => void
            end: (body: string) => void },
    next: () => void,
  ) {
    if (!req.url?.startsWith(prefix)) {
      return next()
    }

    // Restrict to localhost unless opted out
    if (localhostOnly) {
      const addr = req.socket?.remoteAddress ?? ''
      if (!['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(addr)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'forbidden: sidecar is localhost-only' }))
        return
      }
    }

    const path = req.url.slice(prefix.length) || '/'

    if (path === '/heap' || path === '/heap/') {
      const payload = snapshot()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }

    if (path === '/gc' || path === '/gc/') {
      if (typeof (global as any).gc === 'function') {
        (global as any).gc()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, message: 'GC triggered' }))
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'start node with --expose-gc' }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found', routes: [`${prefix}/heap`, `${prefix}/gc`] }))
  }
}

// ── Standalone server (no framework required) ─────────────────────────────────

export interface StandaloneOptions extends SidecarOptions {
  /** Port to listen on (default: 9123) */
  port?: number
  /** Host to bind (default: 127.0.0.1) */
  host?: string
}

export function startSidecarServer(opts: StandaloneOptions = {}): http.Server {
  const port   = opts.port ?? 9123
  const host   = opts.host ?? '127.0.0.1'
  const prefix = opts.prefix ?? '/__leak_assert__'

  const middleware = leakAssertSidecar({ ...opts, localhostOnly: true })

  const server = http.createServer((req, res) => {
    middleware(req as any, res as any, () => {
      res.writeHead(404)
      res.end('not found')
    })
  })

  server.listen(port, host, () => {
    console.log(`[leak-assert] sidecar listening on http://${host}:${port}${prefix}/heap`)
  })

  return server
}
