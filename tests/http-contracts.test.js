import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { relative, resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiDevServerPlugin } from '../api/_lib/devServer'
import alerts from '../api/alerts'
import forecastHandler from '../api/forecast'
import subscribe from '../api/subscribe'
import pushSubscribe from '../api/push/subscribe'
import verifyEmail from '../api/verify-email'
import unsubscribe from '../api/unsubscribe'
import cron from '../api/cron/check-subscriptions'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  verificationEmail: vi.fn(),
  advisoryEmail: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../api/_lib/db', () => ({ query: mocks.query }))
vi.mock('../api/_lib/mail', () => ({
  sendVerificationEmail: mocks.verificationEmail,
  sendAdvisoryEmail: mocks.advisoryEmail,
}))
vi.mock('../api/_lib/push', () => ({ sendPushNotification: mocks.push }))

const handlers = {
  'alerts.ts': alerts,
  'forecast.ts': forecastHandler,
  'subscribe.ts': subscribe,
  'push/subscribe.ts': pushSubscribe,
  'verify-email.ts': verifyEmail,
  'unsubscribe.ts': unsubscribe,
  'cron/check-subscriptions.ts': cron,
}
const appOrigin = 'https://frontend.example.test'
const apiOrigin = 'https://api.example.test'
const nativeFetch = globalThis.fetch
const upstreamFetch = vi.fn()
const pushSubscription = {
  endpoint: 'https://push.example.test/subscription',
  keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' },
}
const signupBody = {
  latitude: 25.7617,
  longitude: -80.1918,
  label: 'Miami',
  email: 'tester@example.test',
  consentText: 'I consent to advisories and can unsubscribe at any time.',
}
let vite
let server
let baseUrl
let errorLog

function dbResult(rows = [], rowCount = rows.length) {
  return { rows, rowCount }
}

function upstreamForecast(wind = 10, { gust = wind, rain = 0, pastWind = 10 } = {}) {
  const time = Array.from({ length: 51 }, (_, i) =>
    new Date(Date.UTC(2026, 10, 1, i)).toISOString().slice(0, 16))
  return {
    timezone: 'UTC',
    current: {
      time: time[3], wind_speed_10m: wind, wind_gusts_10m: gust,
      precipitation: 0, surface_pressure: 1000,
    },
    hourly: {
      time,
      wind_speed_10m: time.map((_, i) => i < 3 ? pastWind : wind),
      wind_gusts_10m: time.map(() => gust),
      precipitation: time.map((_, i) => i >= 3 && i < 27 ? rain / 24 : 0),
      surface_pressure: time.map(() => 1000),
    },
  }
}

function upstreamResponses({ wind = 10, nws = [], gdacs = [] } = {}) {
  upstreamFetch.mockImplementation(async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'api.weather.gov') return Response.json({ features: nws })
    if (url.hostname === 'www.gdacs.org') return Response.json({ features: gdacs })
    if (url.hostname === 'api.open-meteo.com') return Response.json(upstreamForecast(wind))
    throw new Error(`Unexpected upstream request: ${url.hostname}`)
  })
}

async function request(path, { body, headers, ...options } = {}) {
  return nativeFetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Origin: appOrigin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function expectJson(response, status, expected) {
  expect(response.status).toBe(status)
  expect(response.headers.get('content-type')).toContain('application/json')
  const body = await response.json()
  expect(body).toEqual(expected)
  return body
}

async function expectHtml(response, status, message) {
  expect(response.status).toBe(status)
  const body = await response.text()
  expect(body).toMatch(/^<!doctype html><html><body/)
  expect(body).toContain(`<p>${message}</p>`)
  expect(body).toMatch(/<\/body><\/html>$/)
}

function queueSignup({ rateLimited = false } = {}) {
  mocks.query
    .mockResolvedValueOnce(dbResult([{ id: 7 }]))
    .mockResolvedValueOnce(dbResult([{ id: 42 }]))
    .mockResolvedValueOnce(dbResult([{ count: rateLimited ? '3' : '0' }]))
    .mockResolvedValueOnce(dbResult([], 1))
}

function activeSubscription(overrides = {}) {
  return {
    id: 42, subscriber_id: 7,
    latitude: signupBody.latitude, longitude: signupBody.longitude, label: 'Miami',
    channels: { push: false, email: false, sms: false },
    push_subscription_json: null,
    last_computed_level: 0, last_notified_level: 0, notified_official_alerts: [],
    email: signupBody.email, email_verified: false,
    ...overrides,
  }
}

beforeAll(async () => {
  vite = await createViteServer({
    configFile: false,
    root: process.cwd(),
    plugins: [apiDevServerPlugin()],
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  // Use Vitest-loaded handlers so mocks apply; the real HTTP adapter still parses and serializes.
  vi.spyOn(vite, 'ssrLoadModule').mockImplementation(async (file) => {
    const route = relative(resolve('api'), file)
    if (!handlers[route]) throw new Error(`Unexpected handler: ${route}`)
    return { default: handlers[route] }
  })
  server = createHttpServer((req, res) => {
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(() => {
  mocks.query.mockReset().mockRejectedValue(new Error('Unconfigured test database response'))
  mocks.verificationEmail.mockReset().mockResolvedValue(undefined)
  mocks.advisoryEmail.mockReset().mockResolvedValue(undefined)
  mocks.push.mockReset().mockResolvedValue(undefined)
  upstreamFetch.mockReset()
  upstreamResponses()
  vi.stubGlobal('fetch', upstreamFetch)
  vi.stubEnv('APP_BASE_URL', appOrigin)
  vi.stubEnv('API_BASE_URL', apiOrigin)
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret')
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()))
  await vite.close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Endpoint availability and CORS', () => {
  for (const route of Object.keys(handlers)) {
    it(`responds to preflight at /api/${route.replace(/\.ts$/, '')}`, async () => {
      const response = await request(`/api/${route.replace(/\.ts$/, '')}`, { method: 'OPTIONS' })
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      expect(response.headers.get('access-control-allow-origin')).toBe(appOrigin)
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
      expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization')
      expect(response.headers.get('vary')).toContain('Origin')
      expect(mocks.query).not.toHaveBeenCalled()
      expect(upstreamFetch).not.toHaveBeenCalled()
    })
  }

  it('does not grant CORS access to a different frontend origin', async () => {
    const response = await request('/api/subscribe', {
      method: 'OPTIONS', headers: { Origin: 'https://other.example.test' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('does not invent a health endpoint', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  })
})

describe('GET /api/forecast owns forecast analysis', () => {
  for (const [name, wind, options, level] of [
    ['below strong wind', 24, { gust: 38 }, 0],
    ['strong wind', 25, {}, 1],
    ['strong gust', 10, { gust: 39 }, 1],
    ['below tropical storm', 38, { gust: 57 }, 1],
    ['tropical wind', 39, {}, 2],
    ['tropical gust', 10, { gust: 58 }, 2],
    ['below hurricane', 73, { gust: 99 }, 2],
    ['hurricane wind', 74, {}, 3],
    ['hurricane gust', 10, { gust: 100 }, 3],
    ['below rainfall', 10, { rain: 2.9 }, 0],
    ['flash flood rainfall', 10, { rain: 3 }, 1],
    ['past wind excluded', 10, { pastWind: 100 }, 0],
  ]) {
    it(`calculates ${name}`, async () => {
      upstreamFetch.mockResolvedValue(Response.json(upstreamForecast(wind, options)))
      const response = await request('/api/forecast?lat=25.7617&lon=-80.1918')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.json()).toEqual({
        timezone: 'UTC',
        current: {
          time: '2026-11-01T03:00', windSpeed: wind, windGusts: options.gust ?? wind,
          precipitation: 0, surfacePressure: 1000,
        },
        advisory: {
          level, label: expect.any(String), description: expect.any(String), color: expect.any(String),
          maxSustainedWind: { value: wind, time: '2026-11-01T03:00' },
          maxGust: { value: options.gust ?? wind, time: '2026-11-01T03:00' },
          next24hPrecipitation: expect.closeTo(options.rain ?? 0),
          flashFloodRisk: options.rain === 3, pressureDropLast3h: 0,
        },
      })
      expect(upstreamFetch.mock.calls[0][0]).toContain('wind_speed_unit=mph')
      expect(upstreamFetch.mock.calls[0][0]).toContain('past_hours=3')
    })
  }
  for (const query of ['', '?lat=bad&lon=0', '?lat=91&lon=0', '?lat=0&lon=181', '?lat=&lon=0']) {
    it(`rejects invalid coordinates ${query}`, async () => {
      await expectJson(await request(`/api/forecast${query}`), 400, {
        error: 'Valid lat and lon query params are required',
      })
      expect(upstreamFetch).not.toHaveBeenCalled()
    })
  }
  it('rejects unsupported methods', async () => {
    await expectJson(await request('/api/forecast', { method: 'POST' }), 405, {
      error: 'Method not allowed',
    })
  })
  it('reports upstream failure', async () => {
    upstreamFetch.mockRejectedValue(new Error('Weather unavailable'))
    await expectJson(await request('/api/forecast?lat=25&lon=-80'), 502, {
      error: 'Could not fetch forecast',
    })
    expect(errorLog).toHaveBeenCalled()
  })
})

describe('GET /api/alerts', () => {
  it('returns normalized NWS/GDACS alerts sorted by severity', async () => {
    upstreamResponses({
      nws: [{
        id: 'nws-1',
        properties: {
          event: 'Hurricane Warning', severity: 'Extreme', headline: 'Evacuate as directed',
          description: 'Official warning', effective: '2026-11-01T00:00:00Z',
          expires: '2026-11-02T00:00:00Z', '@id': 'https://weather.example.test/nws-1',
        },
      }],
      gdacs: [{
        geometry: { type: 'Point', coordinates: [-80.1918, 25.7617] },
        properties: {
          eventtype: 'TC', eventid: 12, name: 'Cyclone Example', alertlevel: 'Orange',
          iscurrent: 'true', country: 'United States', htmldescription: '<b>Storm nearby</b>',
          fromdate: '2026-11-01T00:00:00Z', todate: '2026-11-02T00:00:00Z',
          url: { report: 'https://gdacs.example.test/12' },
        },
      }],
    })
    await expectJson(await request('/api/alerts?lat=25.7617&lon=-80.1918'), 200, {
      alerts: [{
        source: 'NWS', id: 'nws-1', title: 'Hurricane Warning', severity: 'Extreme',
        headline: 'Evacuate as directed', description: 'Official warning',
        effective: '2026-11-01T00:00:00Z', expires: '2026-11-02T00:00:00Z',
        url: 'https://weather.example.test/nws-1',
      }, {
        source: 'GDACS', id: '12:Orange', title: 'Cyclone Example', severity: 'Orange',
        headline: 'Orange Tropical Cyclone — United States', description: 'Storm nearby',
        effective: '2026-11-01T00:00:00Z', expires: '2026-11-02T00:00:00Z',
        url: 'https://gdacs.example.test/12',
      }],
    })
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://api.weather.gov/alerts/active?point=25.7617,-80.1918', expect.any(Object),
    )
  })

  it('returns an empty array when no official alerts are active', async () => {
    await expectJson(await request('/api/alerts?lat=25&lon=-80'), 200, { alerts: [] })
  })

  it('preserves the current empty-array fallback when upstream providers fail', async () => {
    upstreamFetch.mockRejectedValue(new Error('Provider unavailable'))
    await expectJson(await request('/api/alerts?lat=25&lon=-80'), 200, { alerts: [] })
  })

  for (const query of ['', '?lat=invalid&lon=0', '?lat=25']) {
    it(`rejects missing/non-numeric coordinates: ${query || '(none)'}`, async () => {
      await expectJson(await request(`/api/alerts${query}`), 400, {
        error: 'lat and lon query params are required',
      })
      expect(upstreamFetch).not.toHaveBeenCalled()
    })
  }
})

describe('POST /api/subscribe', () => {
  it('returns the email signup contract and constructs an API verification link', async () => {
    queueSignup()
    await expectJson(await request('/api/subscribe', { method: 'POST', body: signupBody }), 201, {
      subscriptionId: 42, requiresEmailVerification: true, wantsPush: false,
    })
    expect(mocks.verificationEmail).toHaveBeenCalledWith(
      signupBody.email, expect.stringMatching(/^https:\/\/api\.example\.test\/api\/verify-email\?token=[\w-]+$/),
    )
    expect(mocks.query.mock.calls[1][1]).toEqual([
      7, signupBody.latitude, signupBody.longitude, 'Miami',
      JSON.stringify({ email: true, push: false, sms: false }), signupBody.consentText,
    ])
  })

  it('returns the push-only signup contract without sending an email', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([{ id: 7 }]))
      .mockResolvedValueOnce(dbResult([{ id: 42 }]))
    const { email, ...body } = signupBody
    await expectJson(await request('/api/subscribe', {
      method: 'POST', body: { ...body, wantsPush: true },
    }), 201, { subscriptionId: 42, requiresEmailVerification: false, wantsPush: true })
    expect(mocks.verificationEmail).not.toHaveBeenCalled()
  })

  it('rejects unsupported methods', async () => {
    await expectJson(await request('/api/subscribe'), 405, { error: 'Method not allowed' })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  for (const body of [{}, { ...signupBody, consentText: '' }, { ...signupBody, email: '', wantsPush: false }]) {
    it(`rejects invalid signup body ${JSON.stringify(body)}`, async () => {
      await expectJson(await request('/api/subscribe', { method: 'POST', body }), 400, {
        error: 'latitude, longitude, consentText, and at least one of email/wantsPush are required',
      })
      expect(mocks.query).not.toHaveBeenCalled()
    })
  }

  it('returns a validation error for malformed JSON', async () => {
    const response = await nativeFetch(`${baseUrl}/api/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid',
    })
    await expectJson(response, 400, {
      error: 'latitude, longitude, consentText, and at least one of email/wantsPush are required',
    })
  })

  it('returns a rate-limit error without sending verification', async () => {
    queueSignup({ rateLimited: true })
    await expectJson(await request('/api/subscribe', { method: 'POST', body: signupBody }), 429, {
      error: 'Too many verification emails sent recently. Try again later.',
    })
    expect(mocks.verificationEmail).not.toHaveBeenCalled()
  })

  it('returns a stable error shape on a database failure', async () => {
    await expectJson(await request('/api/subscribe', { method: 'POST', body: signupBody }), 500, {
      error: 'Could not create subscription',
    })
    expect(errorLog).toHaveBeenCalled()
  })

  it('returns an error rather than success when verification delivery fails', async () => {
    queueSignup()
    mocks.verificationEmail.mockRejectedValue(new Error('Synthetic mail failure'))
    await expectJson(await request('/api/subscribe', { method: 'POST', body: signupBody }), 500, {
      error: 'Could not create subscription',
    })
    expect(errorLog).toHaveBeenCalled()
  })
})

describe('POST /api/push/subscribe', () => {
  const body = { subscriptionId: 42, pushSubscription }

  it('returns a boolean acknowledgement and stores the push payload', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([], 1))
    await expectJson(await request('/api/push/subscribe', { method: 'POST', body }), 200, { ok: true })
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), [JSON.stringify(pushSubscription), 42])
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('rejects unsupported methods', async () => {
    await expectJson(await request('/api/push/subscribe'), 405, { error: 'Method not allowed' })
  })

  it('rejects malformed payloads without writing to the database', async () => {
    await expectJson(await request('/api/push/subscribe', { method: 'POST', body: {} }), 400, {
      error: 'subscriptionId and pushSubscription are required',
    })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('returns not-found for inactive or missing subscriptions', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([], 0))
    await expectJson(await request('/api/push/subscribe', { method: 'POST', body }), 404, {
      error: 'Subscription not found or inactive',
    })
  })

  it('returns a stable database error contract', async () => {
    await expectJson(await request('/api/push/subscribe', { method: 'POST', body }), 500, {
      error: 'Could not save push subscription',
    })
    expect(errorLog).toHaveBeenCalled()
  })
})

describe('Email verification and unsubscribe HTML contracts', () => {
  const cases = [
    {
      path: '/api/verify-email',
      missing: 'Missing verification token.',
      invalid: 'This verification link is invalid or has expired.',
      success: 'Email confirmed — you will now receive storm advisories for your saved location(s).',
      failure: 'Something went wrong confirming your email. Try the link again shortly.',
      row: { id: 9, subscriber_id: 7 },
      update: 'update subscribers set email_verified = true where id = $1',
      target: 7,
    },
    {
      path: '/api/unsubscribe',
      missing: 'Missing unsubscribe token.',
      invalid: 'This unsubscribe link is invalid or has expired.',
      success: 'You have been unsubscribed from advisories for this location.',
      failure: 'Something went wrong. Try the link again shortly.',
      row: { id: 9, subscription_id: 42 },
      update: 'update subscriptions set active = false where id = $1',
      target: 42,
    },
  ]

  for (const contract of cases) {
    it(`${contract.path}: missing token`, async () => {
      await expectHtml(await request(contract.path), 400, contract.missing)
      expect(mocks.query).not.toHaveBeenCalled()
    })

    it(`${contract.path}: invalid/expired token`, async () => {
      mocks.query.mockResolvedValueOnce(dbResult())
      await expectHtml(await request(`${contract.path}?token=invalid`), 400, contract.invalid)
      expect(mocks.query).toHaveBeenCalledOnce()
    })

    it(`${contract.path}: successful confirmation`, async () => {
      mocks.query.mockResolvedValueOnce(dbResult([contract.row]))
        .mockResolvedValueOnce(dbResult([], 1)).mockResolvedValueOnce(dbResult([], 1))
      await expectHtml(await request(`${contract.path}?token=test-token`), 200, contract.success)
      expect(mocks.query).toHaveBeenCalledWith(contract.update, [contract.target])
      expect(mocks.query.mock.calls[0][1]).toEqual(['test-token'])
    })

    it(`${contract.path}: database failure`, async () => {
      await expectHtml(await request(`${contract.path}?token=test-token`), 500, contract.failure)
      expect(errorLog).toHaveBeenCalled()
    })
  }

  it('keeps unsubscribe confirmation idempotent when updates affect no rows', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([{ id: 9, subscription_id: 42 }]))
      .mockResolvedValueOnce(dbResult([], 0)).mockResolvedValueOnce(dbResult([], 0))
    await expectHtml(await request('/api/unsubscribe?token=used-token'), 200,
      'You have been unsubscribed from advisories for this location.')
  })

  it('rejects an unsubscribe token without a subscription target', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([{ id: 9, subscription_id: null }]))
    await expectHtml(await request('/api/unsubscribe?token=invalid'), 400,
      'This unsubscribe link is invalid or has expired.')
    expect(mocks.query).toHaveBeenCalledOnce()
  })
})

describe('POST /api/cron/check-subscriptions', () => {
  const auth = { Authorization: 'Bearer synthetic-cron-secret' }

  for (const authorization of [undefined, 'Bearer wrong-secret']) {
    it(`rejects ${authorization ? 'incorrect' : 'missing'} credentials before database access`, async () => {
      await expectJson(await request('/api/cron/check-subscriptions', {
        method: 'POST', headers: authorization ? { Authorization: authorization } : {},
      }), 401, { error: 'Unauthorized' })
      expect(mocks.query).not.toHaveBeenCalled()
    })
  }

  it('rejects requests when the cron secret is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 401, { error: 'Unauthorized' })
  })

  it('returns numeric counters for an empty subscription set', async () => {
    mocks.query.mockResolvedValueOnce(dbResult())
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 200, { checked: 0, locations: 0, notified: 0 })
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('checks duplicate locations once without notifying unchanged advisory levels', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([
      activeSubscription(), activeSubscription({ id: 43 }),
    ])).mockResolvedValue(dbResult([], 1))
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 200, { checked: 2, locations: 1, notified: 0 })
    expect(upstreamFetch).toHaveBeenCalledTimes(3)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.advisoryEmail).not.toHaveBeenCalled()
  })

  it('returns raised-advisory counters and correct email/push URL contracts', async () => {
    upstreamResponses({ wind: 74 })
    mocks.query.mockResolvedValueOnce(dbResult([activeSubscription({
      channels: { email: true, push: true, sms: false },
      email_verified: true, push_subscription_json: pushSubscription,
    })])).mockResolvedValue(dbResult([], 1))
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 200, { checked: 1, locations: 1, notified: 1 })
    expect(mocks.push).toHaveBeenCalledWith(pushSubscription, {
      title: 'Storm Advisory: Hurricane-Force Conditions Advisory',
      body: expect.any(String), url: appOrigin,
    })
    expect(mocks.advisoryEmail).toHaveBeenCalledWith(
      signupBody.email, 'Storm Advisory: Hurricane-Force Conditions Advisory', expect.any(String),
      expect.stringMatching(/^https:\/\/api\.example\.test\/api\/unsubscribe\?token=[\w-]+$/),
    )
  })

  it('does not send advisory email to an unverified address', async () => {
    upstreamResponses({ wind: 74 })
    mocks.query.mockResolvedValueOnce(dbResult([activeSubscription({
      channels: { email: true, push: false, sms: false },
    })])).mockResolvedValue(dbResult([], 1))
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 200, { checked: 1, locations: 1, notified: 1 })
    expect(mocks.advisoryEmail).not.toHaveBeenCalled()
  })

  it('returns a stable database error contract', async () => {
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 500, { error: 'Cron run failed' })
    expect(errorLog).toHaveBeenCalled()
  })

  it('returns an error when the forecast provider fails', async () => {
    mocks.query.mockResolvedValueOnce(dbResult([activeSubscription()]))
    upstreamFetch.mockRejectedValue(new Error('Synthetic weather outage'))
    await expectJson(await request('/api/cron/check-subscriptions', {
      method: 'POST', headers: auth,
    }), 500, { error: 'Cron run failed' })
    expect(errorLog).toHaveBeenCalled()
  })
})
