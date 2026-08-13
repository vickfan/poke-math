export async function onRequestGet(context) {
  let ids = []
  try {
    const raw = await context.env.GAME_STATE.get('fainted')
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) ids = arr
  } catch (e) {}
  return new Response(JSON.stringify(ids), {
    headers: { 'Content-Type': 'application/json' }
  })
}
