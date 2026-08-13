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
