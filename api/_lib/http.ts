import type { IncomingMessage, ServerResponse } from 'node:http'

// Minimal shape of what Vercel's Node runtime gives handlers (query/body
// parsed, status/json/send helpers on the response). Defined locally instead
// of depending on @vercel/node, which pulls in ~140 build-tooling packages
// just for these type declarations. The real Vercel platform supplies the
// actual objects at runtime; devServer.ts below shims the same shape locally.
export interface ApiRequest extends IncomingMessage {
  query: Record<string, string>
  body: unknown
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse
  json(body: unknown): ApiResponse
  send(body: string | object): ApiResponse
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => unknown | Promise<unknown>

export function withCors(handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    const appBaseUrl = process.env.APP_BASE_URL
    const origin = req.headers.origin
    if (appBaseUrl && origin === new URL(appBaseUrl).origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.status(204).send('')
      return
    }
    return handler(req, res)
  }
}
