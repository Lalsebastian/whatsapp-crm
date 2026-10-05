// A minimal in-memory PostgREST + Realtime stand-in for end-to-end tests.
//
// Implements the subset the console uses: GET with eq/neq/gt/gte/lt/lte/in/is
// filters, order and limit; HEAD with exact counts; PATCH/POST that update the
// in-memory tables (so a UI action is visible on the next fetch); and
// single-object responses. Realtime websockets are accepted and kept idle.
import { buildFixtures } from './fixtures.js'

export const FAKE_SUPABASE_URL = 'http://127.0.0.1:54329'

function parseValue(raw) {
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

function matches(row, column, expression) {
  const [operator, ...rest] = expression.split('.')
  const raw = rest.join('.')
  const value = row[column]
  switch (operator) {
    case 'eq': return String(value) === String(parseValue(raw))
    case 'neq': return String(value) !== String(parseValue(raw))
    case 'gt': return value != null && value > raw
    case 'gte': return value != null && value >= raw
    case 'lt': return value != null && value < raw
    case 'lte': return value != null && value <= raw
    case 'is': return raw === 'null' ? value == null : String(value) === raw
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''))
      return list.includes(String(value))
    }
    case 'not': return !matches(row, column, rest.join('.'))
    default: return true
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function applyQuery(rows, params) {
  let result = rows
  for (const [key, expression] of params) {
    if (RESERVED.has(key)) continue
    result = result.filter((row) => matches(row, key, expression))
  }
  const order = params.get('order')
  if (order) {
    const [column, direction = 'asc'] = order.split(',')[0].split('.')
    result = [...result].sort((left, right) => {
      const a = left[column]
      const b = right[column]
      if (a == null) return 1
      if (b == null) return -1
      const comparison = a < b ? -1 : a > b ? 1 : 0
      return direction === 'desc' ? -comparison : comparison
    })
  }
  const limit = Number(params.get('limit'))
  if (Number.isFinite(limit) && limit > 0) result = result.slice(0, limit)
  return result
}

/**
 * Wires the fake backend into a page. Returns the live table state so tests
 * can assert on writes the UI made.
 */
export async function useFakeSupabase(page, { fixtures = buildFixtures() } = {}) {
  const tables = fixtures
  const writes = []

  await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => {
    // Accept the socket and stay silent: live updates are not under test.
  })

  await page.route(`${FAKE_SUPABASE_URL}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)
    if (!match) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    const table = match[1]
    const rows = tables[table] ?? []
    const method = request.method()
    const wantsObject = (request.headers().accept || '').includes('vnd.pgrst.object')
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' }

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS' },
      })
    }

    if (method === 'GET' || method === 'HEAD') {
      const result = applyQuery(rows, url.searchParams)
      const range = `0-${Math.max(result.length - 1, 0)}/${result.length}`
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Range': range } })
      if (wantsObject) {
        if (result.length !== 1) {
          return route.fulfill({
            status: 406,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }),
          })
        }
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(result[0]) })
      }
      return route.fulfill({ status: 200, headers: { ...headers, 'Content-Range': range }, contentType: 'application/json', body: JSON.stringify(result) })
    }

    if (method === 'PATCH') {
      const patch = request.postDataJSON() ?? {}
      const targets = applyQuery(rows, url.searchParams)
      targets.forEach((row) => Object.assign(row, patch))
      writes.push({ table, method, patch, ids: targets.map((row) => row.id) })
      const body = wantsObject ? targets[0] ?? null : targets
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
    }

    if (method === 'POST') {
      const payload = request.postDataJSON()
      const inserted = (Array.isArray(payload) ? payload : [payload]).map((row, index) => ({
        id: `${table}-new-${rows.length + index + 1}`,
        created_at: new Date().toISOString(),
        ...row,
      }))
      tables[table] = [...rows, ...inserted]
      writes.push({ table, method, rows: inserted })
      const body = wantsObject ? inserted[0] : inserted
      return route.fulfill({ status: 201, headers, contentType: 'application/json', body: JSON.stringify(body) })
    }

    return route.fulfill({ status: 405, headers })
  })

  return { tables, writes }
}

/** Opens the console as `role` (development role switch stored in localStorage). */
export async function openAs(page, role, path = '/') {
  await page.addInitScript((value) => {
    window.localStorage.setItem('crm-console-role', value)
  }, role)
  await page.goto(path)
}
