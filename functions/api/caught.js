const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle', 'pikachu', 'eevee']

async function readCaught(env) {
  try {
    const raw = await env.GAME_STATE.get('caught')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

export async function onRequestGet(context) {
  const ids = await readCaught(context.env)
  return new Response(JSON.stringify(ids), {
    headers: { 'Content-Type': 'application/json' }
  })
}

export async function onRequestPost(context) {
  let id = null
  try {
    const data = await context.request.json()
    id = typeof data.id === 'string' ? data.id.trim() : null
  } catch (e) {}
  if (!id || STARTER_IDS.includes(id)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid or starter id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const ids = await readCaught(context.env)
  if (!ids.includes(id)) {
    ids.push(id)
    await context.env.GAME_STATE.put('caught', JSON.stringify(ids))
  }
  return new Response(JSON.stringify({ ok: true, ids }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
