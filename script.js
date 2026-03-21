// PokeAPI sprites (https://github.com/PokeAPI/sprites) - use national dex id
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

function getSpriteUrl(id) {
  return `${SPRITE_BASE}/${id}.png`
}

// POKEMON_LIST, STARTER_IDS, EVOLUTION_STAGE in pokemon.js. CAUGHT_IDS built from file on load.

function getMaxHp(pokemon) {
  const stage = EVOLUTION_STAGE[pokemon.id] ?? 0
  return 3 + stage
}

// Selectable = starters + ids from data/caught.json (set after loadCaughtFile)
let CAUGHT_IDS = [...STARTER_IDS]

// Pokémon that lost (HP 0); loaded from data/fainted.json, saved on change
let FAINTED_IDS = []

// Evolution state: base form id -> current form id (loaded from data/evolution.json)
let EVOLUTION_STATE = {}
// Level per slot (base form id). Each player Pokémon starts at 1, +1 per battle win. Evolve at 3 and 5.
let LEVEL_STATE = {}
// Slot (base form id) of the Pokémon currently in use, for evolution updates
let selectedSlotId = null

let selectedPokemon = null
let opponentPokemon = null
let playerHp = 3
let opponentHp = 3
let playerMaxHp = 3
let opponentMaxHp = 3
let currentCorrectAnswer = null
/** 'math' | 'mcq' – used for answer comparison and correct-button highlight */
let currentQuestionMode = 'math'
/** MCQ rows from server (GET /api/sheet-questions); empty if URL not set or fetch failed */
let SHEET_QUESTIONS = []
/** null = all types (MATH, EN, ZH CSV); else array from server allowedQuestionTypes */
let ALLOWED_QUESTION_TYPES = null
let answerButtonsDisabled = false
let catchAttemptPhase = false
let caughtThisBattle = null

const startScreen = document.getElementById('start-screen')
const battleScreen = document.getElementById('battle-screen')
const resultScreen = document.getElementById('result-screen')
const pokemonGrid = document.getElementById('pokemon-grid')
const startBtn = document.getElementById('start-btn')
const nextBattleBtn = document.getElementById('next-battle-btn')
const changePokemonBtn = document.getElementById('change-pokemon-btn')

function getNextEvolutionId(currentId) {
  const multi = MULTI_EVOLUTIONS[currentId]
  if (multi && multi.length > 0) {
    return multi[Math.floor(Math.random() * multi.length)]
  }
  return NEXT_EVOLUTION[currentId] ?? null
}

function getPlayerLevel(baseId) {
  return LEVEL_STATE[baseId] ?? 1
}

function getRandomPokemon(excludeId) {
  // Opponent must not be any Pokemon the player can start with (including caught)
  let pool = POKEMON_LIST.filter(p => !CAUGHT_IDS.includes(p.id))
  if (pool.length === 0) {
    pool = POKEMON_LIST.filter(p => p.id !== excludeId)
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

function getSelectablePokemon() {
  const slots = CAUGHT_IDS.map(slotId => ({
    slotId,
    formId: EVOLUTION_STATE[slotId] || slotId,
    pokemon: POKEMON_LIST.find(p => p.id === (EVOLUTION_STATE[slotId] || slotId))
  })).filter(x => x.pokemon)
  const available = slots.filter(x => !FAINTED_IDS.includes(x.formId))
  const list = available.length > 0 ? available : slots
  return list.slice().sort((a, b) => a.pokemon.spriteId - b.pokemon.spriteId)
}

function renderPokemonSelection() {
  pokemonGrid.innerHTML = ''
  getSelectablePokemon().forEach(({ slotId, pokemon }) => {
    const card = document.createElement('div')
    card.className = 'pokemon-card'
    card.dataset.id = slotId
    const img = document.createElement('img')
    img.src = getSpriteUrl(pokemon.spriteId)
    img.alt = pokemon.name
    img.className = 'sprite-img'
    img.loading = 'lazy'
    img.onerror = function () {
      this.style.display = 'none'
      const fallback = this.nextElementSibling
      if (fallback) fallback.style.display = ''
    }
    const fallback = document.createElement('span')
    fallback.className = 'sprite-fallback'
    fallback.style.display = 'none'
    fallback.textContent = pokemon.emoji
    const spriteWrap = document.createElement('div')
    spriteWrap.className = 'sprite'
    spriteWrap.appendChild(img)
    spriteWrap.appendChild(fallback)
    card.appendChild(spriteWrap)
    const nameEl = document.createElement('div')
    nameEl.className = 'name'
    nameEl.textContent = pokemon.name
    card.appendChild(nameEl)
    card.addEventListener('click', () => selectPokemon(slotId))
    pokemonGrid.appendChild(card)
  })
}

function selectPokemon(slotId) {
  selectedSlotId = slotId
  const formId = EVOLUTION_STATE[slotId] || slotId
  selectedPokemon = POKEMON_LIST.find(p => p.id === formId)
  document.querySelectorAll('.pokemon-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.id === slotId)
  })
  startBtn.disabled = false
}

function startBattle() {
  if (!selectedPokemon) return
  opponentPokemon = getRandomPokemon(selectedPokemon.id)
  playerMaxHp = getMaxHp(selectedPokemon)
  opponentMaxHp = getMaxHp(opponentPokemon)
  playerHp = playerMaxHp
  opponentHp = opponentMaxHp

  startScreen.classList.add('hidden')
  battleScreen.classList.remove('hidden')
  resultScreen.classList.add('hidden')

  updateBattleUI()
  // Defer so the battle screen is painted before we render the question
  setTimeout(showNextQuestion, 50)
}

function setSpriteEl(el, pokemon) {
  el.innerHTML = ''
  const img = document.createElement('img')
  img.src = getSpriteUrl(pokemon.spriteId)
  img.alt = pokemon.name
  img.className = 'sprite-img'
  img.onerror = function () {
    this.style.display = 'none'
    const fallback = document.createElement('span')
    fallback.className = 'sprite-fallback'
    fallback.textContent = pokemon.emoji
    el.appendChild(fallback)
  }
  el.appendChild(img)
}

function updateBattleUI() {
  document.getElementById('player-name').textContent = selectedPokemon.name
  document.getElementById('opponent-name').textContent = opponentPokemon.name
  setSpriteEl(document.getElementById('player-sprite'), selectedPokemon)
  setSpriteEl(document.getElementById('opponent-sprite'), opponentPokemon)

  const playerBar = document.getElementById('player-hp-bar')
  const opponentBar = document.getElementById('opponent-hp-bar')
  const hpClass = (hp, max) => (hp >= (max * 2) / 3 ? 'hp-full' : hp >= max / 3 ? 'hp-mid' : 'hp-low')
  playerBar.innerHTML = `<div class="${hpClass(playerHp, playerMaxHp)}" style="width: ${(playerHp / playerMaxHp) * 100}%"></div>`
  opponentBar.innerHTML = `<div class="${hpClass(opponentHp, opponentMaxHp)}" style="width: ${(opponentHp / opponentMaxHp) * 100}%"></div>`

  document.getElementById('player-hp-text').textContent = `${playerHp}/${playerMaxHp}`
  const playerLevelEl = document.getElementById('player-level')
  if (playerLevelEl) {
    const baseId = selectedSlotId != null ? selectedSlotId : (BASE_FORM[selectedPokemon.id] || selectedPokemon.id)
    playerLevelEl.textContent = `Lv.${getPlayerLevel(baseId)}`
  }
  const opponentLevelEl = document.getElementById('opponent-level')
  if (opponentLevelEl) opponentLevelEl.textContent = 'Lv.5'
}

// Generate addition or subtraction with operands and result within 0..20
function generateMathQuestion() {
  const isAddition = Math.random() < 0.5
  let a, b, answer
  if (isAddition) {
    // Addition: a + b between 1 and 20, no zeros
    // Pick a in [1, 19], then b in [1, 20 - a]
    a = 1 + Math.floor(Math.random() * 19)
    b = 1 + Math.floor(Math.random() * (20 - a))
    answer = a + b
  } else {
    // Subtraction: a - b between 1 and 20, no zeros, and b < a
    // Pick a in [2, 20], then b in [1, a - 1]
    a = 2 + Math.floor(Math.random() * 19)
    if (a > 20) a = 20
    b = 1 + Math.floor(Math.random() * (a - 1))
    answer = a - b
  }
  const operator = isAddition ? '+' : '-'
  const questionText = `${a} ${operator} ${b} = ?`
  return { a, b, operator, questionText, answer }
}

function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = out[i]
    out[i] = out[j]
    out[j] = temp
  }
  return out
}

function getWrongAnswers(correct, count = 3) {
  const wrong = new Set()
  const range = 21
  while (wrong.size < count) {
    const offset = Math.floor(Math.random() * (range * 2 + 1)) - range
    const value = correct + offset
    if (value >= 0 && value <= 20 && value !== correct) wrong.add(value)
  }
  return [...wrong]
}

function loadSheetQuestions() {
  return fetch('/api/sheet-questions')
    .then(r => r.json().catch(() => ({})))
    .then(data => {
      SHEET_QUESTIONS = Array.isArray(data.questions) ? data.questions : []
      const t = data.allowedQuestionTypes
      ALLOWED_QUESTION_TYPES = Array.isArray(t) ? t : null
    })
    .catch(() => {
      SHEET_QUESTIONS = []
      ALLOWED_QUESTION_TYPES = null
    })
}

function normalizeMcqRow(row) {
  const q = String(row.question || '').trim()
  const ans = String(row.answer || '').trim()
  const w1 = String(row.wrong1 || '').trim()
  const w2 = String(row.wrong2 || '').trim()
  const w3 = String(row.wrong3 || '').trim()
  if (!q || !ans || !w1 || !w2 || !w3) return null
  if (new Set([ans, w1, w2, w3]).size !== 4) return null
  return { question: q, answer: ans, choices: shuffle([ans, w1, w2, w3]) }
}

function pickMcqFromSheet() {
  for (let n = 0; n < 20; n++) {
    const row = SHEET_QUESTIONS[Math.floor(Math.random() * SHEET_QUESTIONS.length)]
    const mcq = normalizeMcqRow(row)
    if (mcq) return { mode: 'mcq', ...mcq }
  }
  return null
}

function pickBattleQuestion() {
  const allTypes = ALLOWED_QUESTION_TYPES == null || ALLOWED_QUESTION_TYPES.length === 0
  const mathOk = allTypes || ALLOWED_QUESTION_TYPES.includes('MATH')
  const csvOk =
    SHEET_QUESTIONS.length > 0 &&
    (allTypes || ALLOWED_QUESTION_TYPES.includes('EN') || ALLOWED_QUESTION_TYPES.includes('ZH'))

  const tryMcqFirst = csvOk && (!mathOk || Math.random() < 0.5)
  if (tryMcqFirst) {
    const mcq = pickMcqFromSheet()
    if (mcq) return mcq
  }
  if (mathOk) {
    const m = generateMathQuestion()
    const wrongs = getWrongAnswers(m.answer)
    const choices = shuffle([m.answer, ...wrongs])
    return {
      mode: 'math',
      a: m.a,
      b: m.b,
      operator: m.operator,
      answer: m.answer,
      choices
    }
  }
  if (csvOk) {
    const mcq = pickMcqFromSheet()
    if (mcq) return mcq
  }
  console.warn('pickBattleQuestion: no question pool matches ALLOWED_QUESTION_TYPE; using MATH')
  const m = generateMathQuestion()
  const wrongs = getWrongAnswers(m.answer)
  const choices = shuffle([m.answer, ...wrongs])
  return {
    mode: 'math',
    a: m.a,
    b: m.b,
    operator: m.operator,
    answer: m.answer,
    choices
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Wrap emoji (incl. ZWJ sequences) in spans for larger display; escape the rest */
function formatQuestionWithBigEmoji(text) {
  const str = String(text)
  const emojiRun = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu
  const out = []
  let last = 0
  let m
  const re = new RegExp(emojiRun.source, emojiRun.flags)
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out.push(escapeHtml(str.slice(last, m.index)))
    out.push(`<span class="question-emoji">${escapeHtml(m[0])}</span>`)
    last = m.index + m[0].length
  }
  if (last < str.length) out.push(escapeHtml(str.slice(last)))
  return out.join('')
}

function applyQuestionToBattleUI(questionEl, picked, isCatch) {
  if (picked.mode === 'mcq') {
    currentQuestionMode = 'mcq'
    currentCorrectAnswer = picked.answer
    const qHtml = formatQuestionWithBigEmoji(picked.question)
    if (isCatch) {
      questionEl.innerHTML = ''
      const catchLine = document.createElement('div')
      catchLine.textContent = `Catch ${opponentPokemon.name}!`
      const qLine = document.createElement('div')
      qLine.innerHTML = qHtml
      questionEl.appendChild(catchLine)
      questionEl.appendChild(qLine)
    } else {
      questionEl.innerHTML = qHtml
    }
  } else {
    currentQuestionMode = 'math'
    currentCorrectAnswer = picked.answer
    const isAddition = picked.operator === '+'
    const inner = `${picked.a} <span class="math-operator math-operator--${isAddition ? 'plus' : 'minus'}">${picked.operator}</span> ${picked.b} = ?`
    if (isCatch) {
      questionEl.innerHTML = `Catch ${opponentPokemon.name}!<br>${inner}`
    } else {
      questionEl.innerHTML = inner
    }
  }
}

function isPlayerAnswerCorrect(value) {
  if (currentQuestionMode === 'mcq') {
    return String(value).trim() === String(currentCorrectAnswer).trim()
  }
  return Number(value) === currentCorrectAnswer
}

function isButtonTheCorrectAnswer(btn) {
  const t = btn.textContent.trim()
  if (currentQuestionMode === 'mcq') {
    return t === String(currentCorrectAnswer).trim()
  }
  return Number(t) === currentCorrectAnswer
}

function showNextQuestion() {
  const questionEl = document.getElementById('math-question')
  const grid = document.getElementById('answers-grid')
  const feedbackEl = document.getElementById('feedback')

  questionEl.textContent = '...'
  grid.innerHTML = ''
  feedbackEl.classList.add('hidden')
  feedbackEl.textContent = ''
  answerButtonsDisabled = false

  const picked = pickBattleQuestion()
  applyQuestionToBattleUI(questionEl, picked, false)
  const choices = picked.choices

  choices.forEach(value => {
    const btn = document.createElement('button')
    btn.className = 'answer-btn'
    btn.textContent = value
    btn.addEventListener('click', () => submitAnswer(value, btn))
    grid.appendChild(btn)
  })
}

function playCatchAnimation(onComplete) {
  const ball = document.getElementById('catch-pokeball')
  const opponentSprite = document.getElementById('opponent-sprite')
  ball.classList.remove('catch-pokeball-hidden')
  ball.classList.remove('catch-throw', 'catch-wiggle', 'catch-success')
  opponentSprite.classList.remove('catch-sprite-black', 'catch-sprite-shrink')

  requestAnimationFrame(() => {
    ball.classList.add('catch-throw')
  })

  setTimeout(() => {
    opponentSprite.classList.add('catch-sprite-black')
  }, 650)
  setTimeout(() => {
    opponentSprite.classList.add('catch-sprite-shrink')
  }, 850)
  setTimeout(() => {
    ball.classList.add('catch-wiggle')
  }, 1350)
  setTimeout(() => {
    ball.classList.add('catch-success')
  }, 2800)
  setTimeout(() => {
    ball.classList.remove('catch-throw', 'catch-wiggle', 'catch-success')
    ball.classList.add('catch-pokeball-hidden')
    opponentSprite.classList.remove('catch-sprite-black', 'catch-sprite-shrink')
    opponentSprite.style.animation = ''
    opponentSprite.style.filter = ''
    opponentSprite.style.transform = ''
    if (onComplete) onComplete()
  }, 3350)
}

function showCaughtPrompt(pokemon, onClose) {
  const prompt = document.getElementById('caught-prompt')
  const spriteEl = document.getElementById('caught-prompt-sprite')
  const nameEl = document.getElementById('caught-prompt-name')
  const okBtn = document.getElementById('caught-prompt-ok')

  spriteEl.innerHTML = ''
  const img = document.createElement('img')
  img.src = getSpriteUrl(pokemon.spriteId)
  img.alt = pokemon.name
  img.onerror = function () {
    this.style.display = 'none'
    const fallback = document.createElement('span')
    fallback.className = 'sprite-fallback'
    fallback.textContent = pokemon.emoji
    spriteEl.appendChild(fallback)
  }
  spriteEl.appendChild(img)
  nameEl.textContent = pokemon.name

  prompt.classList.remove('hidden')

  const close = () => {
    prompt.classList.add('hidden')
    if (onClose) onClose()
    okBtn.removeEventListener('click', close)
    clearTimeout(timeoutId)
  }
  okBtn.addEventListener('click', close)
  const timeoutId = setTimeout(close, 3500)
}

function showEvolutionPrompt(oldName, nextPokemon) {
  const prompt = document.getElementById('evolution-prompt')
  const spriteEl = document.getElementById('evolution-prompt-sprite')
  const messageEl = document.getElementById('evolution-prompt-message')
  const okBtn = document.getElementById('evolution-prompt-ok')

  spriteEl.innerHTML = ''
  const img = document.createElement('img')
  img.src = getSpriteUrl(nextPokemon.spriteId)
  img.alt = nextPokemon.name
  img.onerror = function () {
    this.style.display = 'none'
    const fallback = document.createElement('span')
    fallback.className = 'sprite-fallback'
    fallback.textContent = nextPokemon.emoji
    spriteEl.appendChild(fallback)
  }
  spriteEl.appendChild(img)
  messageEl.textContent = `${oldName} has evolved into ${nextPokemon.name}!`

  prompt.classList.remove('hidden')

  const close = () => {
    prompt.classList.add('hidden')
    okBtn.removeEventListener('click', close)
    clearTimeout(timeoutId)
  }
  okBtn.addEventListener('click', close)
  const timeoutId = setTimeout(close, 4000)
}

function showCatchQuestion() {
  const questionEl = document.getElementById('math-question')
  const grid = document.getElementById('answers-grid')
  const feedbackEl = document.getElementById('feedback')

  questionEl.textContent = ''
  grid.innerHTML = ''
  feedbackEl.classList.add('hidden')
  feedbackEl.textContent = ''
  answerButtonsDisabled = false

  const picked = pickBattleQuestion()
  applyQuestionToBattleUI(questionEl, picked, true)
  const choices = picked.choices

  choices.forEach(value => {
    const btn = document.createElement('button')
    btn.className = 'answer-btn'
    btn.textContent = value
    btn.addEventListener('click', () => submitAnswer(value, btn))
    grid.appendChild(btn)
  })
}

function submitAnswer(value, btn) {
  if (answerButtonsDisabled) return
  answerButtonsDisabled = true

  const feedbackEl = document.getElementById('feedback')
  const playerSprite = document.getElementById('player-sprite')
  const opponentSprite = document.getElementById('opponent-sprite')
  const isCorrect = isPlayerAnswerCorrect(value)

  if (catchAttemptPhase) {
    document.querySelectorAll('.answer-btn').forEach(b => {
      b.disabled = true
      if (isButtonTheCorrectAnswer(b)) b.classList.add('correct')
      if (b === btn && !isCorrect) b.classList.add('wrong')
    })
    const caught = isCorrect
    if (caught && !CAUGHT_IDS.includes(opponentPokemon.id)) {
      CAUGHT_IDS.push(opponentPokemon.id)
      saveCaughtToFile(opponentPokemon.id)
    }
    caughtThisBattle = caught ? opponentPokemon : null
    catchAttemptPhase = false
    if (caught) {
      playCatchAnimation(() => {
        showCaughtPrompt(opponentPokemon, () => {
          feedbackEl.textContent = `You caught ${opponentPokemon.name}!`
          feedbackEl.className = 'feedback correct-msg'
          feedbackEl.classList.remove('hidden')
          setTimeout(showResult, 1500)
        })
      })
    } else {
      feedbackEl.textContent = `${opponentPokemon.name} got away!`
      feedbackEl.className = 'feedback wrong-msg'
      feedbackEl.classList.remove('hidden')
      setTimeout(showResult, 1500)
    }
    return
  }

  document.querySelectorAll('.answer-btn').forEach(b => {
    b.disabled = true
    if (isButtonTheCorrectAnswer(b)) b.classList.add('correct')
    if (b === btn && !isCorrect) b.classList.add('wrong')
  })

  if (isCorrect) {
    opponentHp -= 1
    feedbackEl.textContent = 'Correct! Opponent loses 1 HP!'
    feedbackEl.className = 'feedback correct-msg'
    playerSprite.classList.add('attack')
    opponentSprite.classList.add('flicker')
  } else {
    playerHp -= 1
    feedbackEl.textContent = 'Wrong! Your Pokémon loses 1 HP!'
    feedbackEl.className = 'feedback wrong-msg'
    opponentSprite.classList.add('attack')
    playerSprite.classList.add('flicker')
  }
  feedbackEl.classList.remove('hidden')

  updateBattleUI()

  const playerBar = document.getElementById('player-hp-bar')
  const opponentBar = document.getElementById('opponent-hp-bar')
  const damagedBar = isCorrect ? opponentBar : playerBar
  const barFill = damagedBar.firstElementChild
  if (barFill) {
    barFill.classList.add('hp-decreasing')
    setTimeout(() => {
      barFill.classList.add('done')
    }, 180)
    setTimeout(() => {
      barFill.classList.remove('hp-decreasing', 'done')
    }, 550)
  }

  setTimeout(() => {
    playerSprite.classList.remove('attack')
    opponentSprite.classList.remove('attack')
  }, 460)
  setTimeout(() => {
    playerSprite.classList.remove('flicker')
    opponentSprite.classList.remove('flicker')
  }, 620)

  if (opponentHp <= 0 || playerHp <= 0) {
    if (opponentHp <= 0 && !catchAttemptPhase) {
      catchAttemptPhase = true
      setTimeout(showCatchQuestion, 800)
    } else {
      setTimeout(showResult, 800)
    }
  } else {
    setTimeout(showNextQuestion, 1200)
  }
}

function showResult() {
  battleScreen.classList.add('hidden')
  resultScreen.classList.remove('hidden')

  const titleEl = document.getElementById('result-title')
  const messageEl = document.getElementById('result-message')

  if (opponentHp <= 0) {
    titleEl.textContent = 'You Win!'
    titleEl.className = 'win'
    const baseId = selectedSlotId != null ? selectedSlotId : (BASE_FORM[selectedPokemon.id] || selectedPokemon.id)
    const level = getPlayerLevel(baseId) + 1
    LEVEL_STATE[baseId] = level
    saveEvolutionToFile()

    // After leveling up: check if level reached 3 or 5 and evolve if possible
    let evolutionForPrompt = null
    const shouldEvolve = (level === 3 || level === 5)
    const nextId = shouldEvolve ? getNextEvolutionId(selectedPokemon.id) : null
    if (nextId) {
      const nextPokemon = POKEMON_LIST.find(p => p.id === nextId)
      if (nextPokemon) {
        const oldName = selectedPokemon.name
        EVOLUTION_STATE[baseId] = nextId
        saveEvolutionToFile()
        if (!CAUGHT_IDS.includes(nextId)) {
          CAUGHT_IDS.push(nextId)
          saveCaughtToFile(nextId)
        }
        selectedPokemon = nextPokemon
        playerMaxHp = getMaxHp(nextPokemon)
        playerHp = playerMaxHp
        evolutionForPrompt = { oldName, nextPokemon }
      }
    }

    if (caughtThisBattle) {
      FAINTED_IDS = []
      saveFaintedToFile()
      let msg = `You caught ${caughtThisBattle.name}! ${selectedPokemon.name} grew to Lv.${level}.`
      if (evolutionForPrompt) msg = `${evolutionForPrompt.oldName} evolved into ${evolutionForPrompt.nextPokemon.name}! ${msg}`
      messageEl.textContent = msg + ' You can choose it from the start next time.'
    } else {
      let msg = `${selectedPokemon.name} defeated ${opponentPokemon.name}. Great math skills! ${selectedPokemon.name} grew to Lv.${level}!`
      if (evolutionForPrompt) {
        msg = `${evolutionForPrompt.oldName} evolved into ${evolutionForPrompt.nextPokemon.name}! ${evolutionForPrompt.nextPokemon.name} defeated ${opponentPokemon.name}. Great math skills!`
      }
      messageEl.textContent = msg
    }
    if (evolutionForPrompt) {
      showEvolutionPrompt(evolutionForPrompt.oldName, evolutionForPrompt.nextPokemon)
    }
    // After each win, restore 1 HP without exceeding max HP
    playerHp = Math.min(playerHp + 1, playerMaxHp)
    updateBattleUI()
    caughtThisBattle = null
  } else {
    if (selectedPokemon && !FAINTED_IDS.includes(selectedPokemon.id)) {
      FAINTED_IDS.push(selectedPokemon.id)
      saveFaintedToFile()
      const baseId = selectedSlotId != null ? selectedSlotId : (BASE_FORM[selectedPokemon.id] || selectedPokemon.id)
      delete EVOLUTION_STATE[baseId]
      LEVEL_STATE[baseId] = 1
      saveEvolutionToFile()
    }
    titleEl.textContent = 'You Lose!'
    titleEl.className = 'lose'
    messageEl.textContent = `${opponentPokemon.name} was too strong. Practice and try again!`
  }
}

function nextBattle() {
  resultScreen.classList.add('hidden')
  battleScreen.classList.remove('hidden')
  catchAttemptPhase = false
  caughtThisBattle = null
  opponentPokemon = getRandomPokemon(selectedPokemon.id)
  opponentMaxHp = getMaxHp(opponentPokemon)
  opponentHp = opponentMaxHp
  // Player HP is not reset; only resets when they choose another Pokémon and start a new run
  updateBattleUI()
  setTimeout(showNextQuestion, 50)
}

function changePokemon() {
  resultScreen.classList.add('hidden')
  startScreen.classList.remove('hidden')
  selectedPokemon = null
  selectedSlotId = null
  startBtn.disabled = true
  renderPokemonSelection()
}

const CAUGHT_STORAGE_KEY = 'pokemon_math_caught_extra'
const EVOLUTION_STORAGE_KEY = 'pokemon_math_evolution'
const FAINTED_STORAGE_KEY = 'pokemon_math_fainted'

function loadCaughtFile() {
  const fromStorage = () => {
    try {
      const raw = localStorage.getItem(CAUGHT_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch (e) {
      return []
    }
  }
  return fetch('data/caught.json')
    .then(res => (res.ok ? res.json() : []))
    .then(fileIds => {
      const fromFile = Array.isArray(fileIds) ? fileIds.filter(id => typeof id === 'string' && !STARTER_IDS.includes(id)) : []
      CAUGHT_IDS = [...STARTER_IDS, ...fromFile]
      try {
        localStorage.setItem(CAUGHT_STORAGE_KEY, JSON.stringify(fromFile))
      } catch (e) {}
    })
    .catch(() => {
      const fromLocal = fromStorage()
      const extra = fromLocal.filter(id => typeof id === 'string' && !STARTER_IDS.includes(id))
      CAUGHT_IDS = [...STARTER_IDS, ...extra]
    })
}

function loadFaintedFile() {
  const fromStorage = () => {
    try {
      const raw = localStorage.getItem(FAINTED_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch (e) {
      return []
    }
  }
  return fetch('data/fainted.json')
    .then(res => (res.ok ? res.json() : []))
    .then(fileIds => {
      const fromFile = Array.isArray(fileIds) ? fileIds.filter(id => typeof id === 'string') : []
      FAINTED_IDS = fromFile
      try {
        localStorage.setItem(FAINTED_STORAGE_KEY, JSON.stringify(fromFile))
      } catch (e) {}
    })
    .catch(() => {
      FAINTED_IDS = fromStorage()
    })
}

function saveFaintedToFile() {
  try {
    localStorage.setItem(FAINTED_STORAGE_KEY, JSON.stringify(FAINTED_IDS))
  } catch (e) {}
  fetch('api/fainted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: FAINTED_IDS })
  }).catch(() => {})
}

function loadEvolutionFile() {
  const fromStorage = () => {
    try {
      const raw = localStorage.getItem(EVOLUTION_STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  }
  return fetch('data/evolution.json')
    .then(res => (res.ok ? res.json() : null))
    .then(obj => {
      if (obj && typeof obj === 'object' && obj.state !== undefined && obj.levels !== undefined) {
        EVOLUTION_STATE = obj.state && typeof obj.state === 'object' ? obj.state : {}
        LEVEL_STATE = obj.levels && typeof obj.levels === 'object' ? obj.levels : {}
      } else {
        EVOLUTION_STATE = obj && typeof obj === 'object' ? obj : {}
        LEVEL_STATE = {}
      }
      try {
        localStorage.setItem(EVOLUTION_STORAGE_KEY, JSON.stringify({ state: EVOLUTION_STATE, levels: LEVEL_STATE }))
      } catch (e) {}
    })
    .catch(() => {
      const stored = fromStorage()
      if (stored && typeof stored === 'object' && stored.state !== undefined) {
        EVOLUTION_STATE = stored.state || {}
        LEVEL_STATE = stored.levels || {}
      } else {
        EVOLUTION_STATE = typeof stored === 'object' && stored !== null ? stored : {}
        LEVEL_STATE = {}
      }
    })
}

function saveEvolutionToFile() {
  const payload = { state: EVOLUTION_STATE, levels: LEVEL_STATE }
  try {
    localStorage.setItem(EVOLUTION_STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {}
  fetch('api/evolution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
}

function saveCaughtToFile(id) {
  if (STARTER_IDS.includes(id)) return
  const addToStorage = () => {
    try {
      const raw = localStorage.getItem(CAUGHT_STORAGE_KEY)
      const arr = raw ? JSON.parse(raw) : []
      if (!arr.includes(id)) {
        arr.push(id)
        localStorage.setItem(CAUGHT_STORAGE_KEY, JSON.stringify(arr))
      }
    } catch (e) {}
  }
  addToStorage()
  fetch('api/caught', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }).catch(() => {})
}

// Init: load caught, fainted, evolution, sheet MCQs then render
Promise.all([loadCaughtFile(), loadFaintedFile(), loadEvolutionFile(), loadSheetQuestions()]).then(() => {
  renderPokemonSelection()
  startBtn.addEventListener('click', startBattle)
  nextBattleBtn.addEventListener('click', nextBattle)
  changePokemonBtn.addEventListener('click', changePokemon)
})
