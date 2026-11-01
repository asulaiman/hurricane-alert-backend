import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import type { ApiRequest, ApiResponse } from './http'

function resolveHandlerFile(apiDir: string, pathname: string): string | null {
  const rel = pathname.replace(/^\/api\/?/, '')
  if (!rel || rel.startsWith('_lib')) return null
  const candidates = [path.join(apiDir, `${rel}.ts`), path.join(apiDir, rel, 'index.ts')]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  return raw
}

function decorateResponse(res: ServerResponse): ApiResponse {
  const decorated = res as ApiResponse
  decorated.status = (code) => {
    res.statusCode = code
    return decorated
  }
  decorated.json = (body) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
    return decorated
  }
  decorated.send = (body) => {
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
    return decorated
  }
  return decorated
}

// Vite's dev server has no concept of Vercel's /api serverless functions, so
// this mounts them as middleware for `npm run dev` — using server.ssrLoadModule
// so the .ts files go through Vite's own transform pipeline (a plain Node
// import() can't execute untranspiled TypeScript). The handler files
// themselves are unaware of this shim and deploy unmodified on Vercel.
export function apiDevServerPlugin(): Plugin {
  const apiDir = path.resolve(process.cwd(), 'api')

  return {
    name: 'api-dev-server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

        const url = new URL(req.url, 'http://localhost')
        const file = resolveHandlerFile(apiDir, url.pathname)
        if (!file) return next()

        try {
          const mod = await server.ssrLoadModule(file)
          const handler = mod.default
          if (typeof handler !== 'function') return next()

          const apiReq = req as ApiRequest
          apiReq.query = Object.fromEntries(url.searchParams.entries())
          apiReq.body =
            req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)

          await handler(apiReq, decorateResponse(res))
        } catch (err) {
          console.error(`[api] ${url.pathname} failed:`, err)
          if (!res.headersSent) res.statusCode = 500
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      })
    },
  }
}
