const VALID_QUESTION_TYPES = new Set(['MATH', 'EN', 'ZH'])

/** null = all types allowed; else subset of MATH, EN, ZH (comma-separated in ALLOWED_QUESTION_TYPE) */
function getAllowedQuestionTypes(env) {
  const raw = env.ALLOWED_QUESTION_TYPE
  if (raw == null || String(raw).trim() === '') return null
  const parts = String(raw)
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
  const out = parts.filter(p => VALID_QUESTION_TYPES.has(p))
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

export async function onRequest(context) {
  const env = context.env
  const allowed = getAllowedQuestionTypes(env)
  let questions = []
  let error = null

  const url = env.QUESTIONS_CSV_URL
  if (!url || !String(url).trim()) {
    error = 'QUESTIONS_CSV_URL not set'
  } else {
    try {
      const res = await fetch(String(url).trim(), {
        headers: { Accept: 'text/csv,*/*' }
      })
      if (!res.ok) throw new Error('Sheet HTTP ' + res.status)
      const text = await res.text()
      const allParsed = parseSheetCsvToQuestions(text)
      questions = filterQuestionsForAllowedTypes(allParsed, allowed)
    } catch (err) {
      error = err.message
    }
  }

  return new Response(
    JSON.stringify({
      ok: error == null || questions.length > 0,
      questions,
      error,
      allowedQuestionTypes: allowed
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  )
}