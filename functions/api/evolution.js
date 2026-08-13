export async function onRequestGet(context) {
  let obj = { state: {}, levels: {} }
  try {
    const raw = await context.env.GAME_STATE.get('evolution')
    if (raw != null) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed
      }
    }
  } catch (e) {}
  return new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json' }
  })
}

export async function onRequestPost(context) {
  let data = null
  try {
    data = await context.request.json()
  } catch (e) {}
  const obj = {
    state: data && typeof data.state === 'object' && !Array.isArray(data.state) ? data.state : {},
    levels: data && typeof data.levels === 'object' && !Array.isArray(data.levels) ? data.levels : {}
  }
  await context.env.GAME_STATE.put('evolution', JSON.stringify(obj))
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
}