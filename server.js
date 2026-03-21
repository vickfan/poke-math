const http = require('http')
const fs = require('fs')
const path = require('path')

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return
  try {
    const raw = fs.readFileSync(envPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (key) process.env[key] = val
    }
  } catch (e) {
    console.warn('Could not read .env:', e.message)
  }
}

loadEnvFile()

const PORT = 3000
const SHEET_CACHE_MS = 5 * 60 * 1000

let sheetCache = { questions: [], fetchedAt: 0, error: null }

/** null = all types allowed; else subset of MATH, EN, ZH (comma-separated in ALLOWED_QUESTION_TYPE) */
function getAllowedQuestionTypes() {
  const raw = process.env.ALLOWED_QUESTION_TYPE
  if (raw == null || String(raw).trim() === '') return null
  const parts = String(raw)
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
  const valid = new Set(['MATH', 'EN', 'ZH'])
  const out = parts.filter(p => valid.has(p))
  return out.length === 0 ? null : out
}

function normalizeSheetLanguage(lang) {
  const L = String(lang || '').trim().toUpperCase()
  if (L === 'EN' || L === 'ENGLISH') return 'EN'
  if (L === 'ZH' || L === 'CN' || L === 'CHS' || L === 'CHINESE' || L === 'ZH-CN' || L === 'ZH-HANS') return 'ZH'
  return L
}

/** Keep CSV rows whose language matches allowed EN/ZH when types are restricted */
function filterQuestionsForAllowedTypes(questions, allowed) {
  if (allowed == null) return questions
  const wantEn = allowed.includes('EN')
  const wantZh = allowed.includes('ZH')
  if (!wantEn && !wantZh) return []
  return questions.filter(q => {
    const L = normalizeSheetLanguage(q.language)
    if (wantEn && L === 'EN') return true
    if (wantZh && L === 'ZH') return true
    return false
  })
}

/** Parse CSV with quoted fields (handles commas inside quotes). */
function parseCSV(text) {
  const rows = []
  let row = []
  let cell = ''
  let i = 0
  let inQuotes = false
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (c === '\n') {
      row.push(cell)
      if (row.some(x => String(x).trim() !== '')) rows.push(row)
      row = []
      cell = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    cell += c
    i++
  }
  row.push(cell)
  if (row.some(x => String(x).trim() !== '')) rows.push(row)
  return rows
}

function parseSheetCsvToQuestions(csvText) {
  const rows = parseCSV(csvText)
  if (rows.length < 2) return []

  const header = rows[0].map(h => String(h).replace(/^\uFEFF/, '').trim().toLowerCase())
  const col = (name, alt) => {
    let idx = header.indexOf(name)
    if (idx === -1 && alt) idx = header.indexOf(alt)
    return idx
  }
  const idx = {
    id: col('id'),
    type: col('type'),
    question: col('question'),
    answer: col('answer', 'anwer'),
    wrong1: col('wrong1'),
    wrong2: col('wrong2'),
    wrong3: col('wrong3'),
    language: col('language'),
    active: col('active')
  }
  if (idx.question < 0 || idx.answer < 0) return []

  const out = []
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    const get = (i) => (i >= 0 && i < cells.length ? String(cells[i]).trim() : '')

    const activeRaw = idx.active >= 0 ? get(idx.active).toUpperCase() : 'TRUE'
    if (activeRaw !== 'TRUE' && activeRaw !== '1' && activeRaw !== 'YES') continue

    let rowType = get(idx.type).toUpperCase()
    let languageCell = idx.language >= 0 ? get(idx.language) : ''
    if (rowType === 'EN' || rowType === 'ZH') {
      languageCell = rowType
      rowType = 'MCQ'
    }
    if (rowType !== 'MCQ') continue

    const question = get(idx.question)
    const answer = get(idx.answer)
    const w1 = get(idx.wrong1)
    const w2 = get(idx.wrong2)
    const w3 = get(idx.wrong3)
    if (!question || !answer || !w1 || !w2 || !w3) continue

    const choices = [answer, w1, w2, w3]
    if (new Set(choices).size !== 4) continue

    out.push({
      id: get(idx.id) || String(r),
      type: 'MCQ',
      question,
      answer,
      wrong1: w1,
      wrong2: w2,
      wrong3: w3,
      language: languageCell
    })
  }
  return out
}

async function refreshSheetQuestions() {
  const url = process.env.QUESTIONS_CSV_URL
  if (!url || !String(url).trim()) {
    sheetCache.error = 'QUESTIONS_CSV_URL not set'
    return
  }
  const res = await fetch(String(url).trim(), {
    headers: { Accept: 'text/csv,*/*' }
  })
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`)
  const text = await res.text()
  const allParsed = parseSheetCsvToQuestions(text)
  const allowed = getAllowedQuestionTypes()
  sheetCache.questions = filterQuestionsForAllowedTypes(allParsed, allowed)
  sheetCache.fetchedAt = Date.now()
  sheetCache.error = null
}
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

  // GET /api/sheet-questions – MCQ rows from published CSV (env QUESTIONS_CSV_URL)
  if (url.pathname === '/api/sheet-questions' && req.method === 'GET') {
    ;(async () => {
      try {
        const allowedTypesPayload = getAllowedQuestionTypes()
        if (!process.env.QUESTIONS_CSV_URL || !String(process.env.QUESTIONS_CSV_URL).trim()) {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(
            JSON.stringify({
              ok: false,
              questions: [],
              error: 'QUESTIONS_CSV_URL not set',
              allowedQuestionTypes: allowedTypesPayload
            })
          )
          return
        }
        const stale = !sheetCache.fetchedAt || Date.now() - sheetCache.fetchedAt > SHEET_CACHE_MS
        if (stale) {
          try {
            await refreshSheetQuestions()
          } catch (err) {
            sheetCache.error = err.message
            console.error('QUESTIONS_CSV_URL fetch failed:', err.message)
          }
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(
          JSON.stringify({
            ok: sheetCache.error == null || sheetCache.questions.length > 0,
            questions: sheetCache.questions,
            error: sheetCache.error,
            allowedQuestionTypes: allowedTypesPayload
          })
        )
      } catch (e) {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            ok: false,
            questions: sheetCache.questions || [],
            error: e.message,
            allowedQuestionTypes: getAllowedQuestionTypes()
          })
        )
      }
    })()
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
  if (process.env.QUESTIONS_CSV_URL && String(process.env.QUESTIONS_CSV_URL).trim()) {
    console.log('Sheet MCQ: QUESTIONS_CSV_URL is set (cached via GET /api/sheet-questions).')
  } else {
    console.log('Sheet MCQ: set QUESTIONS_CSV_URL in .env or environment to load questions from Google Sheets.')
  }
  const qTypes = getAllowedQuestionTypes()
  if (qTypes == null) {
    console.log('Questions: ALLOWED_QUESTION_TYPE not set — MATH, EN, and ZH (CSV) are all allowed.')
  } else {
    console.log('Questions: ALLOWED_QUESTION_TYPE =', qTypes.join(', '))
  }
})
