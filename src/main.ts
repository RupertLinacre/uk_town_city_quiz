import './style.css'
import {
  geoIdentity,
  geoPath,
  pointer,
  select,
  type GeoPermissibleObjects,
} from 'd3'

import ukBoundaries from './generated/uk-country-boundaries.json'
import { normalizeAnswer } from './normalize'
import { quizTowns, type QuizTown } from './town-data'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const MOBILE_CHEAT_HOLD_MS = 1600
const MAP_PADDING = 18
const LONDON_DETAIL_ZOOM = 1.85

type BoundaryFeature = GeoPermissibleObjects & {
  properties?: {
    ctry18nm?: string
  }
}

type BoundaryFeatureCollection = {
  type: 'FeatureCollection'
  features: BoundaryFeature[]
}

type BritishGridPoint = {
  easting: number
  northing: number
}

type TownWithGrid = QuizTown & BritishGridPoint

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required element missing: ${selector}`)
  }

  return element
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function wgs84ToOsgb36(latitude: number, longitude: number): { latitude: number; longitude: number } {
  const height = 0
  const phi = toRadians(latitude)
  const lambda = toRadians(longitude)
  const a = 6378137
  const b = 6356752.3141
  const eSquared = 1 - (b * b) / (a * a)
  const nu = a / Math.sqrt(1 - eSquared * Math.sin(phi) ** 2)
  const x1 = (nu + height) * Math.cos(phi) * Math.cos(lambda)
  const y1 = (nu + height) * Math.cos(phi) * Math.sin(lambda)
  const z1 = ((1 - eSquared) * nu + height) * Math.sin(phi)

  const tx = -446.448
  const ty = 125.157
  const tz = -542.06
  const s = -20.4894 * 1e-6
  const rx = toRadians(-0.1502 / 3600)
  const ry = toRadians(-0.2470 / 3600)
  const rz = toRadians(-0.8421 / 3600)

  const x2 = tx + (1 + s) * x1 + -rz * y1 + ry * z1
  const y2 = ty + rz * x1 + (1 + s) * y1 + -rx * z1
  const z2 = tz + -ry * x1 + rx * y1 + (1 + s) * z1

  const a2 = 6377563.396
  const b2 = 6356256.909
  const eSquared2 = 1 - (b2 * b2) / (a2 * a2)
  const p = Math.sqrt(x2 * x2 + y2 * y2)
  let phi2 = Math.atan2(z2, p * (1 - eSquared2))
  let previousPhi = 0

  while (Math.abs(phi2 - previousPhi) > 1e-12) {
    previousPhi = phi2
    const nu2 = a2 / Math.sqrt(1 - eSquared2 * Math.sin(phi2) ** 2)
    phi2 = Math.atan2(z2 + eSquared2 * nu2 * Math.sin(phi2), p)
  }

  return {
    latitude: toDegrees(phi2),
    longitude: toDegrees(Math.atan2(y2, x2)),
  }
}

function latLonToBritishGrid(latitude: number, longitude: number): BritishGridPoint {
  const osgb36 = wgs84ToOsgb36(latitude, longitude)
  const phi = toRadians(osgb36.latitude)
  const lambda = toRadians(osgb36.longitude)
  const a = 6377563.396
  const b = 6356256.909
  const f0 = 0.9996012717
  const phi0 = toRadians(49)
  const lambda0 = toRadians(-2)
  const n0 = -100000
  const e0 = 400000
  const eSquared = 1 - (b * b) / (a * a)
  const n = (a - b) / (a + b)
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const nu = (a * f0) / Math.sqrt(1 - eSquared * sinPhi ** 2)
  const rho = (a * f0 * (1 - eSquared)) / (1 - eSquared * sinPhi ** 2) ** 1.5
  const etaSquared = nu / rho - 1
  const meridionalArc =
    b *
    f0 *
    ((1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * (phi - phi0) -
      (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(phi - phi0) * Math.cos(phi + phi0) +
      ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * (phi - phi0)) * Math.cos(2 * (phi + phi0)) -
      (35 / 24) * n ** 3 * Math.sin(3 * (phi - phi0)) * Math.cos(3 * (phi + phi0)))
  const tanPhi = Math.tan(phi)
  const deltaLambda = lambda - lambda0

  const northing =
    n0 +
    meridionalArc +
    (deltaLambda ** 2 / 2) * nu * sinPhi * cosPhi +
    (deltaLambda ** 4 / 24) *
      nu *
      sinPhi *
      cosPhi ** 3 *
      (5 - tanPhi ** 2 + 9 * etaSquared) +
    (deltaLambda ** 6 / 720) *
      nu *
      sinPhi *
      cosPhi ** 5 *
      (61 - 58 * tanPhi ** 2 + tanPhi ** 4)
  const easting =
    e0 +
    deltaLambda * nu * cosPhi +
    (deltaLambda ** 3 / 6) * nu * cosPhi ** 3 * (nu / rho - tanPhi ** 2) +
    (deltaLambda ** 5 / 120) *
      nu *
      cosPhi ** 5 *
      (5 - 18 * tanPhi ** 2 + tanPhi ** 4 + 14 * etaSquared - 58 * tanPhi ** 2 * etaSquared)

  return { easting, northing }
}

function aliasesForTown(town: QuizTown): string[] {
  return [
    town.name,
    ...(town.aliases ?? []),
  ]
    .map(normalizeAnswer)
    .filter(Boolean)
}

const towns: TownWithGrid[] = quizTowns.map((town) => ({
  ...town,
  ...latLonToBritishGrid(town.latitude, town.longitude),
}))
const townById = new Map(towns.map((town) => [town.id, town]))
const aliasToTownId = new Map<string, string>()

for (const town of towns) {
  for (const alias of aliasesForTown(town)) {
    if (!aliasToTownId.has(alias)) {
      aliasToTownId.set(alias, town.id)
    }
  }
}

const townsByLetter = alphabet.map((letter) => ({
  letter,
  towns: towns
    .filter((town) => town.name[0]?.toUpperCase() === letter)
    .sort((left, right) => left.name.localeCompare(right.name)),
}))

const app = requireElement<HTMLDivElement>('#app')
document.title = 'UK Towns and Cities Quiz'

app.innerHTML = `
  <main class="shell">
    <section class="quiz">
      <div class="quiz__copy">
        <header class="hero">
          <p class="eyebrow">UK Towns & Cities</p>
          <h1>Name the top 100 UK towns and cities by population</h1>
        </header>
        <section class="stats" aria-live="polite">
          <article class="stat-card">
            <span class="stat-card__label">Score</span>
            <strong id="score" class="stat-card__value">0/${towns.length}</strong>
            <span id="remaining" class="stat-card__meta">${towns.length} left</span>
          </article>
          <article class="stat-card stat-card--timer">
            <span class="stat-card__label">Time</span>
            <strong id="timer" class="stat-card__value">00:00</strong>
            <button id="give-up-button" class="give-up-button" type="button">Give up</button>
          </article>
        </section>
        <section class="answer-panel">
          <input
            id="guess-input"
            class="answer-panel__input"
            type="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="words"
            spellcheck="false"
            inputmode="search"
            enterkeyhint="search"
            aria-label="Enter a town or city"
            placeholder="Start typing a town or city..."
          />
          <p id="status" class="status" aria-live="polite"></p>
        </section>
        <p class="source-note">
          Population ranking: World Population Review 2026 table. Boundary map: ONS countries, Dec 2018, ultra-generalised clipped boundaries.
        </p>
      </div>
      <section class="map-card" aria-label="Map of the United Kingdom with unlabelled town and city dots">
        <div class="map-card__toolbar">
          <button id="reset-map-button" class="map-tool-button" type="button">Reset map</button>
          <button id="london-map-button" class="map-tool-button" type="button">London detail</button>
        </div>
        <div id="map-frame" class="map-frame"></div>
      </section>
    </section>
    <section class="tracker" aria-labelledby="tracker-title">
      <div class="tracker__header">
        <p class="eyebrow">Answer Board</p>
        <h2 id="tracker-title">A-Z</h2>
      </div>
      <div id="letter-board" class="letter-board"></div>
    </section>
  </main>
  <div id="win-overlay" class="win-overlay" hidden>
    <section class="win-overlay__card" role="dialog" aria-modal="true" aria-labelledby="win-title">
      <p class="eyebrow">Complete</p>
      <h2 id="win-title">All 100 Found</h2>
      <p id="win-message" class="win-overlay__message"></p>
      <button id="win-close-button" class="win-overlay__button" type="button">Return to map</button>
    </section>
  </div>
`

const scoreElement = requireElement<HTMLElement>('#score')
const timerElement = requireElement<HTMLElement>('#timer')
const remainingElement = requireElement<HTMLElement>('#remaining')
const statusElement = requireElement<HTMLElement>('#status')
const answerInput = requireElement<HTMLInputElement>('#guess-input')
const giveUpButton = requireElement<HTMLButtonElement>('#give-up-button')
const resetMapButton = requireElement<HTMLButtonElement>('#reset-map-button')
const londonMapButton = requireElement<HTMLButtonElement>('#london-map-button')
const mapFrame = requireElement<HTMLElement>('#map-frame')
const letterBoard = requireElement<HTMLElement>('#letter-board')
const winOverlay = requireElement<HTMLElement>('#win-overlay')
const winMessageElement = requireElement<HTMLElement>('#win-message')
const winCloseButton = requireElement<HTMLButtonElement>('#win-close-button')

const solvedTownIds = new Set<string>()
const revealedTownIds = new Set<string>()
const slotByTownId = new Map<string, HTMLLIElement>()
const markerByTownId = new Map<string, SVGCircleElement>()
let quizStartedAt: number | null = null
let quizFinished = false
let intervalHandle = window.setInterval(tick, 250)
let selectedTownId: string | null = null
let mapZoom = 1
let mapPan: [number, number] = [0, 0]
let mapProjection = geoIdentity()
let renderMapFrameId: number | null = null
let dragStart: { pointer: [number, number]; pan: [number, number] } | null = null

function elapsedMilliseconds(): number {
  return quizStartedAt === null ? 0 : Math.max(0, Date.now() - quizStartedAt)
}

function renderScore(): void {
  scoreElement.textContent = `${solvedTownIds.size}/${towns.length}`
  remainingElement.textContent = `${towns.length - solvedTownIds.size} left`
}

function renderStatus(message: string, tone: 'neutral' | 'success' | 'muted' = 'neutral'): void {
  statusElement.textContent = message
  statusElement.dataset.tone = tone
}

function slotWidthForTown(town: QuizTown): number {
  return Math.max(5.2, Math.min(14, town.name.length * 0.54 + 1.5))
}

function applySlotState(townId: string): void {
  const town = townById.get(townId)
  const slot = slotByTownId.get(townId)

  if (!town || !slot) {
    return
  }

  const solved = solvedTownIds.has(townId)
  const revealed = revealedTownIds.has(townId)
  slot.className = [
    'town-slot',
    solved ? 'town-slot--solved' : 'town-slot--empty',
    revealed ? 'town-slot--revealed' : '',
  ].filter(Boolean).join(' ')
  slot.textContent = solved ? town.name : ''
  slot.title = solved ? `${town.name}, population ${formatNumber(town.population)}` : ''
}

function renderTracker(): void {
  letterBoard.replaceChildren()
  slotByTownId.clear()

  for (const { letter, towns: letterTowns } of townsByLetter) {
    const section = document.createElement('section')
    section.className = 'letter-section'

    const heading = document.createElement('h3')
    heading.textContent = letter

    const list = document.createElement('ul')
    list.className = 'letter-section__list'

    for (const town of letterTowns) {
      const slot = document.createElement('li')
      slot.dataset.townId = town.id
      slot.style.setProperty('--slot-width', `${slotWidthForTown(town)}rem`)
      attachSlotCheatInteractions(slot, town.id)
      slotByTownId.set(town.id, slot)
      applySlotState(town.id)
      list.append(slot)
    }

    section.append(heading, list)
    letterBoard.append(section)
  }
}

function attachSlotCheatInteractions(slot: HTMLLIElement, townId: string): void {
  let holdTimeoutId: number | null = null
  let startX: number | null = null
  let startY: number | null = null

  const clearHold = (): void => {
    if (holdTimeoutId !== null) {
      window.clearTimeout(holdTimeoutId)
      holdTimeoutId = null
    }

    startX = null
    startY = null
  }

  slot.addEventListener('click', (event) => {
    if (!event.shiftKey || solvedTownIds.has(townId) || quizFinished) {
      return
    }

    event.preventDefault()
    solveTown(townId, 'reveal')
  })

  slot.addEventListener('touchstart', (event) => {
    clearHold()

    if (event.touches.length !== 1 || solvedTownIds.has(townId) || quizFinished) {
      return
    }

    const touch = event.touches[0]
    startX = touch.clientX
    startY = touch.clientY
    holdTimeoutId = window.setTimeout(() => {
      clearHold()
      solveTown(townId, 'reveal')
    }, MOBILE_CHEAT_HOLD_MS)
  }, { passive: true })

  slot.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1 || startX === null || startY === null) {
      clearHold()
      return
    }

    const touch = event.touches[0]

    if (Math.abs(touch.clientX - startX) > 4 || Math.abs(touch.clientY - startY) > 4) {
      clearHold()
    }
  }, { passive: true })

  slot.addEventListener('touchend', clearHold)
  slot.addEventListener('touchcancel', clearHold)
}

function projectTown(town: TownWithGrid): [number, number] {
  const projected = mapProjection([town.easting, town.northing]) ?? [0, 0]
  return [
    projected[0] * mapZoom + mapPan[0],
    projected[1] * mapZoom + mapPan[1],
  ]
}

function markerRadius(town: TownWithGrid): number {
  const base = town.population >= 900000 ? 6.8 : town.population >= 300000 ? 5.5 : 4.6
  return Math.max(3.8, base / Math.sqrt(mapZoom))
}

function renderMap(): void {
  const bounds = mapFrame.getBoundingClientRect()
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  const boundaryData = ukBoundaries as BoundaryFeatureCollection

  mapProjection = geoIdentity()
    .reflectY(true)
    .fitExtent(
      [
        [MAP_PADDING, MAP_PADDING],
        [width - MAP_PADDING, height - MAP_PADDING],
      ],
      boundaryData as unknown as GeoPermissibleObjects,
    )

  const mapPath = geoPath(mapProjection)
  const svg = select(mapFrame)
    .selectAll<SVGSVGElement, null>('svg')
    .data([null])
    .join('svg')
    .attr('class', 'uk-map')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', 'Unlabelled map of the United Kingdom with dots for the top 100 towns and cities')

  const viewport = svg
    .selectAll<SVGGElement, null>('g.map-viewport')
    .data([null])
    .join('g')
    .attr('class', 'map-viewport')
    .attr('transform', `translate(${mapPan[0]} ${mapPan[1]}) scale(${mapZoom})`)

  viewport
    .selectAll<SVGPathElement, BoundaryFeature>('path.country-boundary')
    .data(boundaryData.features, (feature) => feature.properties?.ctry18nm ?? '')
    .join('path')
    .attr('class', 'country-boundary')
    .attr('data-country', (feature) => feature.properties?.ctry18nm ?? '')
    .attr('d', (feature) => mapPath(feature) ?? '')

  const markerLayer = svg
    .selectAll<SVGGElement, null>('g.marker-layer')
    .data([null])
    .join('g')
    .attr('class', 'marker-layer')

  markerLayer
    .selectAll<SVGCircleElement, TownWithGrid>('circle.town-marker')
    .data(towns, (town) => town.id)
    .join('circle')
    .attr('class', (town) => {
      const solved = solvedTownIds.has(town.id)
      const selected = selectedTownId === town.id
      return [
        'town-marker',
        solved ? 'town-marker--solved' : 'town-marker--unsolved',
        revealedTownIds.has(town.id) ? 'town-marker--revealed' : '',
        selected ? 'town-marker--selected' : '',
      ].filter(Boolean).join(' ')
    })
    .attr('cx', (town) => projectTown(town)[0])
    .attr('cy', (town) => projectTown(town)[1])
    .attr('r', markerRadius)
    .each(function (town) {
      markerByTownId.set(town.id, this)
    })
    .on('click', (event, town) => {
      selectedTownId = selectedTownId === town.id ? null : town.id

      if (event.shiftKey && !solvedTownIds.has(town.id) && !quizFinished) {
        solveTown(town.id, 'reveal')
        return
      }

      renderMap()
    })

  const selectedTown = selectedTownId ? townById.get(selectedTownId) : null
  const selectedPoint = selectedTown ? projectTown(selectedTown) : null

  svg
    .selectAll<SVGGElement, TownWithGrid>('g.map-tooltip')
    .data(selectedTown && selectedPoint ? [selectedTown] : [], (town) => town.id)
    .join(
      (enter) => {
        const group = enter.append('g').attr('class', 'map-tooltip')
        group.append('rect').attr('rx', 8)
        group.append('text')
        return group
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr('transform', () => {
      const [x, y] = selectedPoint ?? [0, 0]
      return `translate(${Math.min(width - 130, Math.max(18, x + 12))} ${Math.max(18, y - 42)})`
    })
    .each(function (town) {
      const group = select(this)
      const solved = solvedTownIds.has(town.id)
      const label = solved ? town.name : `${town.name[0]}...`
      const text = group.select<SVGTextElement>('text')
        .attr('x', 10)
        .attr('y', 18)
        .text(`${label} · ${formatNumber(town.population)}`)

      const textLength = text.node()?.getComputedTextLength() ?? 100
      group.select<SVGRectElement>('rect')
        .attr('width', textLength + 20)
        .attr('height', 28)
    })
}

function scheduleMapRender(): void {
  if (renderMapFrameId !== null) {
    return
  }

  renderMapFrameId = window.requestAnimationFrame(() => {
    renderMapFrameId = null
    renderMap()
  })
}

function solveTown(townId: string, source: 'answer' | 'reveal' = 'answer'): void {
  const town = townById.get(townId)

  if (!town || solvedTownIds.has(townId) || quizFinished) {
    return
  }

  if (quizStartedAt === null) {
    quizStartedAt = Date.now()
  }

  solvedTownIds.add(townId)
  selectedTownId = townId

  if (source === 'reveal') {
    revealedTownIds.add(townId)
  }

  answerInput.value = ''
  applySlotState(townId)
  renderScore()
  scheduleMapRender()

  if (solvedTownIds.size === towns.length) {
    finishQuiz(true)
    return
  }

  renderStatus(
    source === 'reveal'
      ? `${town.name} revealed.`
      : `${town.name} accepted.`,
    source === 'reveal' ? 'neutral' : 'success',
  )
}

function maybeAcceptGuess(): void {
  const normalizedGuess = normalizeAnswer(answerInput.value)

  if (!normalizedGuess || quizFinished) {
    return
  }

  const townId = aliasToTownId.get(normalizedGuess)

  if (townId && !solvedTownIds.has(townId)) {
    solveTown(townId)
  }
}

function submitGuess(): void {
  const normalizedGuess = normalizeAnswer(answerInput.value)

  if (!normalizedGuess || quizFinished) {
    return
  }

  const townId = aliasToTownId.get(normalizedGuess)

  if (!townId) {
    renderStatus('No match yet.', 'muted')
    return
  }

  if (solvedTownIds.has(townId)) {
    renderStatus(`${townById.get(townId)?.name ?? 'That place'} is already solved.`, 'muted')
    return
  }

  solveTown(townId)
}

function revealAll(): void {
  if (quizFinished) {
    return
  }

  for (const town of towns) {
    if (!solvedTownIds.has(town.id)) {
      solvedTownIds.add(town.id)
      revealedTownIds.add(town.id)
      applySlotState(town.id)
    }
  }

  finishQuiz(false)
}

function finishQuiz(celebrate: boolean): void {
  quizFinished = true
  window.clearInterval(intervalHandle)
  answerInput.disabled = true
  giveUpButton.disabled = true
  const elapsed = formatTime(elapsedMilliseconds())
  const revealedCount = revealedTownIds.size
  const message = celebrate
    ? `All ${towns.length} places found in ${elapsed}${revealedCount ? `, with ${revealedCount} revealed` : ''}.`
    : `Revealed the board at ${elapsed}.`

  renderScore()
  renderMap()
  renderStatus(message, celebrate ? 'success' : 'muted')
  winMessageElement.textContent = message

  if (celebrate) {
    winOverlay.hidden = false
    document.body.dataset.winOverlayOpen = 'true'
    winCloseButton.focus()
  }
}

function tick(): void {
  if (quizFinished) {
    return
  }

  timerElement.textContent = formatTime(elapsedMilliseconds())
}

function resetMapView(): void {
  selectedTownId = null
  mapZoom = 1
  mapPan = [0, 0]
  renderMap()
}

function focusLondon(): void {
  const london = townById.get('london')

  if (!london) {
    return
  }

  const frameBounds = mapFrame.getBoundingClientRect()
  const [x, y] = projectTown(london)
  mapZoom = LONDON_DETAIL_ZOOM
  mapPan = [
    frameBounds.width / 2 - x * LONDON_DETAIL_ZOOM,
    frameBounds.height / 2 - y * LONDON_DETAIL_ZOOM,
  ]
  selectedTownId = 'london'
  renderMap()
}

answerInput.addEventListener('input', maybeAcceptGuess)
answerInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  submitGuess()
})
giveUpButton.addEventListener('click', revealAll)
resetMapButton.addEventListener('click', resetMapView)
londonMapButton.addEventListener('click', focusLondon)
winCloseButton.addEventListener('click', () => {
  winOverlay.hidden = true
  delete document.body.dataset.winOverlayOpen
  answerInput.focus()
})

mapFrame.addEventListener('wheel', (event) => {
  event.preventDefault()
  const factor = Math.exp(-Math.max(-80, Math.min(80, event.deltaY)) * 0.0028)
  const nextZoom = Math.max(0.8, Math.min(4, mapZoom * factor))
  const [pointerX, pointerY] = pointer(event, mapFrame)
  const zoomRatio = nextZoom / mapZoom
  mapPan = [
    pointerX - (pointerX - mapPan[0]) * zoomRatio,
    pointerY - (pointerY - mapPan[1]) * zoomRatio,
  ]
  mapZoom = nextZoom
  scheduleMapRender()
}, { passive: false })

mapFrame.addEventListener('pointerdown', (event) => {
  mapFrame.setPointerCapture(event.pointerId)
  dragStart = {
    pointer: [event.clientX, event.clientY],
    pan: [...mapPan],
  }
})

mapFrame.addEventListener('pointermove', (event) => {
  if (!dragStart) {
    return
  }

  mapPan = [
    dragStart.pan[0] + event.clientX - dragStart.pointer[0],
    dragStart.pan[1] + event.clientY - dragStart.pointer[1],
  ]
  scheduleMapRender()
})

mapFrame.addEventListener('pointerup', () => {
  dragStart = null
})

mapFrame.addEventListener('pointercancel', () => {
  dragStart = null
})

window.addEventListener('resize', scheduleMapRender)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !winOverlay.hidden) {
    event.preventDefault()
    winOverlay.hidden = true
    delete document.body.dataset.winOverlayOpen
    answerInput.focus()
  }
})

renderScore()
renderTracker()
renderStatus('')
renderMap()
tick()
answerInput.focus()
