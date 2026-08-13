const KEY = 'fainted'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function readFaintedIds(env) {
  try {
    const raw = await env.GAME_STATE.get(KEY)
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(id => typeof id === 'string') : []
  } catch (e) {
    return []
  }
}

export async function onRequestGet(context) {
  const ids = await readFaintedIds(context.env)
  return jsonResponse(ids)
}

export async function onRequestPost(context) {
  let ids = []
  try {
    const data = await context.request.json()
    ids = Array.isArray(data.ids) ? data.ids.filter(id => typeof id === 'string') : []
  } catch (e) {}
  try {
    await context.env.GAME_STATE.put(KEY, JSON.stringify(ids))
  } catch (e) {
    return jsonResponse({ ok: false, error: 'write failed' }, 500)
  }
  return jsonResponse({ ok: true, ids })
}
