const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3000
const CAUGHT_FILE = path.join(__dirname, 'data', 'caught.json')
const FAINTED_FILE = path.join(__dirname, 'data', 'fainted.json')
const EVOLUTION_FILE = path.join(__dirname, 'data', 'evolution.json')

const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle', 'pikachu', 'eevee']

function readCaught() {
  try {
    const raw = fs.readFileSync(CAUGHT_FILE, 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function writeCaught(ids) {
  const dir = path.dirname(CAUGHT_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(CAUGHT_FILE, JSON.stringify(ids, null, 2), 'utf8')
}

function readFainted() {
  try {
    const raw = fs.readFileSync(FAINTED_FILE, 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function writeFainted(ids) {
  const dir = path.dirname(FAINTED_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(FAINTED_FILE, JSON.stringify(ids, null, 2), 'utf8')
}

function readEvolution() {
  try {
    const raw = fs.readFileSync(EVOLUTION_FILE, 'utf8')
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch (e) {
    return {}
  }
}

function writeEvolution(obj) {
  const dir = path.dirname(EVOLUTION_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(EVOLUTION_FILE, JSON.stringify(obj, null, 2), 'utf8')
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  // GET /data/caught.json – return current caught list (non-starters only)
  if (url.pathname === '/data/caught.json' && req.method === 'GET') {
    const ids = readCaught()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(ids))
    return
  }

  // GET /data/fainted.json – return current fainted list
  if (url.pathname === '/data/fainted.json' && req.method === 'GET') {
    const ids = readFainted()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(ids))
    return
  }

  // GET /data/evolution.json – return evolution state { baseId: formId }
  if (url.pathname === '/data/evolution.json' && req.method === 'GET') {
    const obj = readEvolution()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
    return
  }

  // POST /api/evolution – set evolution state and levels (body: { state: object, levels: object })
  if (url.pathname === '/api/evolution' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      let obj = { state: {}, levels: {} }
      try {
        const data = JSON.parse(body)
        obj = {
          state: data.state && typeof data.state === 'object' ? data.state : {},
          levels: data.levels && typeof data.levels === 'object' ? data.levels : {}
        }
      } catch (e) {}
      try {
        writeEvolution(obj)
      } catch (err) {
        console.error('Failed to write evolution.json:', err.message)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'write failed' }))
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
    return
  }

  // POST /api/fainted – set full fainted list (body: { ids: string[] })
  if (url.pathname === '/api/fainted' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      let ids = []
      try {
        const data = JSON.parse(body)
        ids = Array.isArray(data.ids) ? data.ids.filter(id => typeof id === 'string') : []
      } catch (e) {}
      try {
        writeFainted(ids)
      } catch (err) {
        console.error('Failed to write fainted.json:', err.message)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'write failed' }))
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, ids }))
    })
    return
  }

  // POST /api/caught – append one id (ignores starters and duplicates)
  if (url.pathname === '/api/caught' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      let id = null
      try {
        const data = JSON.parse(body)
        id = typeof data.id === 'string' ? data.id.trim() : null
      } catch (e) {}
      if (!id || STARTER_IDS.includes(id)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'invalid or starter id' }))
        return
      }
      const ids = readCaught()
      if (!ids.includes(id)) {
        ids.push(id)
        try {
          writeCaught(ids)
        } catch (err) {
          console.error('Failed to write caught.json:', err.message)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'write failed' }))
          return
        }
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, ids }))
    })
    return
  }

  // Static files
  const filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname)
  const ext = path.extname(filePath)
  const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.ico': 'image/x-icon'
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`Pokémon Math Battle server at http://localhost:${PORT}`)
  console.log('Edit data/caught.json, data/fainted.json, data/evolution.json to control progress.')
})
