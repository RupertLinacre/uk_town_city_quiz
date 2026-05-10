import './style.css'
import {
  geoMercator,
  geoPath,
  pointer,
  select,
  type GeoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from 'd3'

import { normalizeAnswer } from './normalize'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const MOBILE_CHEAT_HOLD_MS = 1600
const MAP_PADDING = 18
const OSM_TILE_SIZE = 256
const DEFAULT_EXTRA_ANSWER_RANK_LIMIT = 300
const SETTINGS_QUERY_PARAM = 'settings'
const COUNTY_LABEL_MAX_FONT_SIZE = 13
const COUNTY_LABEL_MIN_FONT_SIZE = 2.6
const COUNTY_LABEL_WIDTH_RATIO = 0.72
const COUNTY_LABEL_HEIGHT_RATIO = 0.68
const COUNTY_LABEL_LINE_HEIGHT = 1.05
const COUNTY_LABEL_CHARACTER_WIDTH = 0.58
const DEFAULT_CITY_LABEL_FONT_SIZE = 12.5
const CITY_LABEL_MIN_FONT_SIZE = 8
const CITY_LABEL_MAX_FONT_SIZE = 18
const CITY_LABEL_STROKE_WIDTH = 2.4

type TrackerMode = 'alphabetical' | 'county' | 'population'

type AppSettings = {
  extraAnswerRankLimit: number
  showCountyNames: boolean
  showCityLabels: boolean
  cityLabelSize: number
}

type Geometry = {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

type BuiltUpAreaProperties = {
  code: string
  name: string
  alternateName: string | null
  aliases: string[]
  areaHectares: number | null
  population: number | null
  populationYear: number | null
  populationSource: string | null
  populationSourceCode: string | null
  country: 'England' | 'Scotland' | 'Wales'
  county: string
  centroid: [number, number]
  isTop100: boolean
  populationRank: number | null
  rank: number | null
}

type BuiltUpAreaFeature = {
  type: 'Feature'
  properties: BuiltUpAreaProperties
  geometry: Geometry
}

type BoundaryFeature = GeoPermissibleObjects & {
  properties?: {
    CTYUA23CD?: string
    CTYUA23NM?: string
    ctry18nm?: string
  }
}

type FeatureCollection<TFeature> = {
  type: 'FeatureCollection'
  features: TFeature[]
}

type Tile = {
  z: number
  x: number
  y: number
  href: string
  topLeft: [number, number]
  bottomRight: [number, number]
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required element missing: ${selector}`)
  }

  return element
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)

  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function formatNumber(value: number | null): string {
  return value === null ? 'population unavailable' : new Intl.NumberFormat('en-GB').format(value)
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function populationBand(population: number | null): string {
  if (population === null) {
    return 'Population unavailable'
  }

  if (population >= 1_000_000) {
    return '1m+'
  }

  if (population >= 500_000) {
    return '500k-1m'
  }

  if (population >= 200_000) {
    return '200k-500k'
  }

  if (population >= 100_000) {
    return '100k-200k'
  }

  return '<100k'
}

function slotWidthForArea(area: BuiltUpAreaFeature): number {
  return Math.max(5.2, Math.min(16, area.properties.name.length * 0.54 + 1.5))
}

function splitCountyLabel(name: string): string[] {
  const words = name.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)

  if (words.length <= 1) {
    return words
  }

  const connectorWords = new Set(['and', 'of', 'upon', 'with'])
  let bestBreakIndex = 1
  let bestScore = Number.POSITIVE_INFINITY

  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(' ')
    const right = words.slice(index).join(' ')
    const leftEnd = words[index - 1].replace(/[^\w]+$/g, '').toLowerCase()
    const rightStart = words[index].replace(/^[^\w]+/g, '').toLowerCase()
    let score = Math.max(left.length, right.length) * 2 + Math.abs(left.length - right.length)

    if (connectorWords.has(leftEnd)) {
      score += 20
    }

    if (rightStart === 'of' || rightStart === 'upon') {
      score += 10
    }

    if (rightStart === 'and' || rightStart === 'with') {
      score += 4
    }

    if (score <= bestScore) {
      bestScore = score
      bestBreakIndex = index
    }
  }

  return [
    words.slice(0, bestBreakIndex).join(' '),
    words.slice(bestBreakIndex).join(' '),
  ]
}

function countyLabelFontSize(feature: BoundaryFeature, lines: string[], mapPath: GeoPath): number {
  const [[x0, y0], [x1, y1]] = mapPath.bounds(feature)
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const longestLineLength = Math.max(...lines.map((line) => line.length), 1)
  const widthLimitedSize = (width * COUNTY_LABEL_WIDTH_RATIO) / (longestLineLength * COUNTY_LABEL_CHARACTER_WIDTH)
  const heightLimitedSize = (height * COUNTY_LABEL_HEIGHT_RATIO) / (lines.length * COUNTY_LABEL_LINE_HEIGHT)

  return Math.max(
    COUNTY_LABEL_MIN_FONT_SIZE,
    Math.min(COUNTY_LABEL_MAX_FONT_SIZE, widthLimitedSize, heightLimitedSize),
  )
}

function renderCountyLabel(
  labelNode: SVGTextElement,
  feature: BoundaryFeature,
  mapPath: GeoPath,
): void {
  const label = select(labelNode)
  const name = feature.properties?.CTYUA23NM ?? ''
  const lines = splitCountyLabel(name)

  if (lines.length === 0) {
    label.text('')
    return
  }

  const [x, y] = mapPath.centroid(feature)
  const fontSize = countyLabelFontSize(feature, lines, mapPath)

  label
    .attr('x', x)
    .attr('y', y)
    .attr('aria-label', name)
    .attr('data-font-size', fontSize.toFixed(2))
    .style('font-size', `${fontSize}px`)
    .style('stroke-width', `${Math.max(0.65, Math.min(2.2, fontSize * 0.18))}px`)

  label
    .selectAll<SVGTSpanElement, string>('tspan')
    .data(lines)
    .join('tspan')
    .attr('x', x)
    .attr('dy', (_line, index) =>
      index === 0 ? `${-(lines.length - 1) * COUNTY_LABEL_LINE_HEIGHT / 2}em` : `${COUNTY_LABEL_LINE_HEIGHT}em`,
    )
    .text((line) => line)
}

function aliasesForArea(area: BuiltUpAreaFeature): string[] {
  const names = new Set([
    area.properties.name,
    area.properties.alternateName,
    ...(area.properties.aliases ?? []),
  ])
  const parenthetical = area.properties.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)

  if (parenthetical) {
    names.add(parenthetical[1])
  }

  if (area.properties.name === 'Brighton and Hove') {
    names.add('Brighton')
  }

  if (area.properties.name === 'Royal Sutton Coldfield') {
    names.add('Sutton Coldfield')
  }

  return [...names].map((name) => normalizeAnswer(name ?? '')).filter(Boolean)
}

function tileXForLon(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function tileYForLat(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z)
}

function lonForTileX(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function latForTileY(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function clampExtraAnswerRankLimit(value: number): number {
  return Math.max(100, Math.min(1000, Math.round(value)))
}

function clampCityLabelSize(value: number): number {
  return Math.max(CITY_LABEL_MIN_FONT_SIZE, Math.min(CITY_LABEL_MAX_FONT_SIZE, value))
}

function defaultSettings(): AppSettings {
  return {
    extraAnswerRankLimit: DEFAULT_EXTRA_ANSWER_RANK_LIMIT,
    showCountyNames: false,
    showCityLabels: true,
    cityLabelSize: DEFAULT_CITY_LABEL_FONT_SIZE,
  }
}

function applyParsedSettings(settings: AppSettings, parsed: Partial<AppSettings>): AppSettings {
  if (typeof parsed.extraAnswerRankLimit === 'number' && Number.isFinite(parsed.extraAnswerRankLimit)) {
    settings.extraAnswerRankLimit = clampExtraAnswerRankLimit(parsed.extraAnswerRankLimit)
  }

  if (typeof parsed.showCountyNames === 'boolean') {
    settings.showCountyNames = parsed.showCountyNames
  }

  if (typeof parsed.showCityLabels === 'boolean') {
    settings.showCityLabels = parsed.showCityLabels
  }

  if (typeof parsed.cityLabelSize === 'number' && Number.isFinite(parsed.cityLabelSize)) {
    settings.cityLabelSize = clampCityLabelSize(parsed.cityLabelSize)
  }

  return settings
}

function parseSettings(): AppSettings {
  const settings = defaultSettings()
  const params = new URLSearchParams(window.location.search)
  const settingsPayload = params.get(SETTINGS_QUERY_PARAM)

  if (!settingsPayload) {
    return settings
  }

  const candidates = [settingsPayload]

  try {
    candidates.push(decodeURIComponent(settingsPayload))
  } catch {
    // URLSearchParams already decodes ordinary query strings.
  }

  for (const candidate of candidates) {
    try {
      return applyParsedSettings(settings, JSON.parse(candidate) as Partial<AppSettings>)
    } catch {
      continue
    }
  }

  return settings
}

function updateUrlSettings(settings: AppSettings): void {
  const url = new URL(window.location.href)

  url.searchParams.set(SETTINGS_QUERY_PARAM, JSON.stringify(settings))
  window.history.replaceState(null, '', url)
}

const app = requireElement<HTMLDivElement>('#app')
document.title = 'GB Towns and Cities Quiz'
app.innerHTML = `
  <main class="shell shell--loading">
    <section class="loading-panel" aria-live="polite">
      <p class="eyebrow">GB Towns & Cities</p>
      <h1>Loading built-up area boundaries</h1>
    </section>
  </main>
`

async function bootstrap(): Promise<void> {
  const [areaData, countryBoundaryData, countyBoundaryData] = await Promise.all([
    fetchJson<FeatureCollection<BuiltUpAreaFeature>>('/data/built-up-areas.geojson'),
    fetchJson<FeatureCollection<BoundaryFeature>>('/data/gb-country-boundaries.geojson'),
    fetchJson<FeatureCollection<BoundaryFeature>>('/data/gb-county-boundaries.geojson'),
  ])

  const areas = areaData.features
  const topAreas = areas
    .filter((area) => area.properties.isTop100)
    .sort((left, right) => (left.properties.rank ?? 999) - (right.properties.rank ?? 999))
  const mapFitAreaData: FeatureCollection<BuiltUpAreaFeature> = {
    type: 'FeatureCollection',
    features: topAreas,
  }
  const areaByCode = new Map(areas.map((area) => [area.properties.code, area]))
  const aliasToAreaCode = new Map<string, string>()
  const aliasCandidates = [...areas].sort((left, right) => {
    if (left.properties.isTop100 !== right.properties.isTop100) {
      return left.properties.isTop100 ? -1 : 1
    }

    return (right.properties.population ?? -1) - (left.properties.population ?? -1)
  })

  for (const area of aliasCandidates) {
    for (const alias of aliasesForArea(area)) {
      if (!aliasToAreaCode.has(alias)) {
        aliasToAreaCode.set(alias, area.properties.code)
      }
    }
  }

  app.innerHTML = `
    <main class="shell">
      <section class="quiz">
        <div class="quiz__copy">
          <header class="hero">
            <p class="eyebrow">GB Towns & Cities</p>
            <h1>Name the top 100 GB built-up areas by population</h1>
          </header>
          <section class="stats" aria-live="polite">
            <article class="stat-card">
              <span class="stat-card__label">Score</span>
              <strong id="score" class="stat-card__value">0/${topAreas.length}</strong>
              <span id="remaining" class="stat-card__meta">${topAreas.length} left</span>
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
            Boundaries: OS Open Built Up Areas. Population: ONS Census 2021 via OA21 to BUA24 best-fit lookup, plus Scottish Government Census 2022 settlements. London is consolidated from the supplied built-up-area codes.
          </p>
        </div>
        <section class="map-card" aria-label="Map of Great Britain with county borders and unlabelled built-up area boundaries">
          <div class="map-card__toolbar">
            <details class="settings-menu">
              <summary>Settings</summary>
              <div class="settings-menu__panel">
                <label class="settings-menu__field" for="extra-answer-limit-input">
                  Extra answers
                  <input id="extra-answer-limit-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${DEFAULT_EXTRA_ANSWER_RANK_LIMIT}" />
                </label>
                <label class="settings-menu__check" for="show-county-names-input">
                  <input id="show-county-names-input" type="checkbox" />
                  County names
                </label>
                <label class="settings-menu__check" for="show-city-labels-input">
                  <input id="show-city-labels-input" type="checkbox" />
                  Answer labels
                </label>
                <label class="settings-menu__field settings-menu__field--range" for="city-label-size-input">
                  <span>Label size</span>
                  <input id="city-label-size-input" type="range" min="${CITY_LABEL_MIN_FONT_SIZE}" max="${CITY_LABEL_MAX_FONT_SIZE}" step="0.5" value="${DEFAULT_CITY_LABEL_FONT_SIZE}" />
                  <output id="city-label-size-output" for="city-label-size-input">${DEFAULT_CITY_LABEL_FONT_SIZE}</output>
                </label>
              </div>
            </details>
            <button id="reset-map-button" class="map-tool-button" type="button">Reset map</button>
          </div>
          <div id="map-frame" class="map-frame">
            <a class="osm-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>
          </div>
        </section>
      </section>
      <section class="tracker" aria-labelledby="tracker-title">
        <div class="tracker__header">
          <div>
            <p class="eyebrow">Answer Board</p>
            <h2 id="tracker-title">A-Z</h2>
          </div>
          <div class="tracker-toggle" role="group" aria-label="Group answer board">
            <button class="tracker-toggle__button" type="button" data-mode="alphabetical" aria-pressed="true">A-Z</button>
            <button class="tracker-toggle__button" type="button" data-mode="county" aria-pressed="false">County</button>
            <button class="tracker-toggle__button" type="button" data-mode="population" aria-pressed="false">Population</button>
          </div>
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
  const extraAnswerLimitInput = requireElement<HTMLInputElement>('#extra-answer-limit-input')
  const showCountyNamesInput = requireElement<HTMLInputElement>('#show-county-names-input')
  const showCityLabelsInput = requireElement<HTMLInputElement>('#show-city-labels-input')
  const cityLabelSizeInput = requireElement<HTMLInputElement>('#city-label-size-input')
  const cityLabelSizeOutput = requireElement<HTMLOutputElement>('#city-label-size-output')
  const mapFrame = requireElement<HTMLElement>('#map-frame')
  const letterBoard = requireElement<HTMLElement>('#letter-board')
  const trackerTitle = requireElement<HTMLElement>('#tracker-title')
  const trackerToggleButtons = [...document.querySelectorAll<HTMLButtonElement>('.tracker-toggle__button')]
  const winOverlay = requireElement<HTMLElement>('#win-overlay')
  const winMessageElement = requireElement<HTMLElement>('#win-message')
  const winCloseButton = requireElement<HTMLButtonElement>('#win-close-button')

  const solvedAreaCodes = new Set<string>()
  const revealedAreaCodes = new Set<string>()
  const extraFoundAreaCodes = new Set<string>()
  const cluedAreaCodes = new Set<string>()
  const slotByAreaCode = new Map<string, HTMLLIElement>()
  let quizStartedAt: number | null = null
  let quizFinished = false
  const initialSettings = parseSettings()
  let extraAnswerRankLimit = initialSettings.extraAnswerRankLimit
  let showCountyNames = initialSettings.showCountyNames
  let showCityLabels = initialSettings.showCityLabels
  let cityLabelSize = initialSettings.cityLabelSize
  let trackerMode: TrackerMode = 'alphabetical'
  let intervalHandle = window.setInterval(tick, 250)
  let hoveredAreaCode: string | null = null
  let tooltipPoint: [number, number] | null = null
  let mapZoom = 1
  let mapPan: [number, number] = [0, 0]
  let mapProjection: GeoProjection = geoMercator()
  let renderMapFrameId: number | null = null
  let dragStart: { pointerId: number; pointer: [number, number]; pan: [number, number] } | null = null

  function elapsedMilliseconds(): number {
    return quizStartedAt === null ? 0 : Math.max(0, Date.now() - quizStartedAt)
  }

  function renderScore(): void {
    scoreElement.textContent = `${solvedAreaCodes.size}/${topAreas.length}`
    remainingElement.textContent = `${topAreas.length - solvedAreaCodes.size} left`
  }

  function renderStatus(message: string, tone: 'neutral' | 'success' | 'muted' = 'neutral'): void {
    statusElement.textContent = message
    statusElement.dataset.tone = tone
  }

  function isWithinExtraAnswerLimit(area: BuiltUpAreaFeature): boolean {
    const rank = area.properties.populationRank
    return rank !== null && rank <= extraAnswerRankLimit
  }

  function currentSettings(): AppSettings {
    return {
      extraAnswerRankLimit,
      showCountyNames,
      showCityLabels,
      cityLabelSize,
    }
  }

  function syncSettingsUrl(): void {
    updateUrlSettings(currentSettings())
  }

  function updateExtraAnswerRankLimit(): void {
    const parsedLimit = Number(extraAnswerLimitInput.value)

    if (!Number.isFinite(parsedLimit)) {
      extraAnswerLimitInput.value = String(extraAnswerRankLimit)
      return
    }

    extraAnswerRankLimit = clampExtraAnswerRankLimit(parsedLimit)
    extraAnswerLimitInput.value = String(extraAnswerRankLimit)
    syncSettingsUrl()
    renderStatus(`Extra answers limited to the top ${formatNumber(extraAnswerRankLimit)}.`, 'neutral')
  }

  function updateCountyNameSetting(): void {
    showCountyNames = showCountyNamesInput.checked
    syncSettingsUrl()
    renderMap()
  }

  function syncCityLabelSizeControl(): void {
    cityLabelSizeInput.value = String(cityLabelSize)
    cityLabelSizeOutput.textContent = cityLabelSize.toFixed(cityLabelSize % 1 === 0 ? 0 : 1)
  }

  function updateCityLabelSetting(): void {
    showCityLabels = showCityLabelsInput.checked
    syncSettingsUrl()
    renderMap()
  }

  function updateCityLabelSize(): void {
    cityLabelSize = clampCityLabelSize(Number(cityLabelSizeInput.value))
    syncCityLabelSizeControl()
    syncSettingsUrl()
    renderMap()
  }

  function turnOffCityLabels(): void {
    if (!showCityLabels) {
      return
    }

    showCityLabels = false
    showCityLabelsInput.checked = false
    syncSettingsUrl()
  }

  function applySlotState(areaCode: string): void {
    const area = areaByCode.get(areaCode)
    const slot = slotByAreaCode.get(areaCode)

    if (!area || !slot) {
      return
    }

    const solved = solvedAreaCodes.has(areaCode)
    const revealed = revealedAreaCodes.has(areaCode)
    slot.className = [
      'town-slot',
      solved ? 'town-slot--solved' : 'town-slot--empty',
      revealed ? 'town-slot--revealed' : '',
    ].filter(Boolean).join(' ')
    slot.textContent = solved ? area.properties.name : ''
    slot.title = solved ? `${area.properties.name}, population ${formatNumber(area.properties.population)}` : ''
  }

  function renderTracker(): void {
    letterBoard.replaceChildren()
    slotByAreaCode.clear()

    const groups = trackerGroups()
    trackerTitle.textContent = trackerMode === 'alphabetical'
      ? 'A-Z'
      : trackerMode === 'county'
        ? 'County'
        : 'Population'

    for (const group of groups) {
      if (group.areas.length === 0) {
        continue
      }

      const section = document.createElement('section')
      section.className = 'letter-section'

      const heading = document.createElement('h3')
      heading.textContent = group.label

      const list = document.createElement('ul')
      list.className = 'letter-section__list'

      for (const area of group.areas) {
        const slot = document.createElement('li')
        slot.dataset.areaCode = area.properties.code
        slot.style.setProperty('--slot-width', `${slotWidthForArea(area)}rem`)
        attachSlotCheatInteractions(slot, area.properties.code)
        slotByAreaCode.set(area.properties.code, slot)
        applySlotState(area.properties.code)
        list.append(slot)
      }

      section.append(heading, list)
      letterBoard.append(section)
    }
  }

  function trackerGroups(): { label: string; areas: BuiltUpAreaFeature[] }[] {
    if (trackerMode === 'county') {
      const countyNames = [...new Set(topAreas.map((area) => area.properties.county))].sort((left, right) => left.localeCompare(right))

      return countyNames.map((county) => ({
        label: county,
        areas: topAreas
          .filter((area) => area.properties.county === county)
          .sort((left, right) => left.properties.name.localeCompare(right.properties.name)),
      }))
    }

    if (trackerMode === 'population') {
      return ['1m+', '500k-1m', '200k-500k', '100k-200k', '<100k'].map((band) => ({
        label: band,
        areas: topAreas
          .filter((area) => populationBand(area.properties.population) === band)
          .sort((left, right) => (right.properties.population ?? 0) - (left.properties.population ?? 0)),
      }))
    }

    return alphabet.map((letter) => ({
      label: letter,
      areas: topAreas
        .filter((area) => area.properties.name[0]?.toUpperCase() === letter)
        .sort((left, right) => left.properties.name.localeCompare(right.properties.name)),
    }))
  }

  function attachSlotCheatInteractions(slot: HTMLLIElement, areaCode: string): void {
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
      if (!event.shiftKey || solvedAreaCodes.has(areaCode) || quizFinished) {
        return
      }

      event.preventDefault()
      solveArea(areaCode, 'reveal')
    })

    slot.addEventListener('touchstart', (event) => {
      clearHold()

      if (event.touches.length !== 1 || solvedAreaCodes.has(areaCode) || quizFinished) {
        return
      }

      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      holdTimeoutId = window.setTimeout(() => {
        clearHold()
        solveArea(areaCode, 'reveal')
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

  function visibleAreaFeatures(): BuiltUpAreaFeature[] {
    return areas.filter((area) => area.properties.isTop100 || extraFoundAreaCodes.has(area.properties.code))
  }

  function createTiles(width: number, height: number): Tile[] {
    if (!quizFinished) {
      return []
    }

    const z = Math.max(5, Math.min(10, Math.round(Math.log2((mapProjection.scale() * mapZoom * 2 * Math.PI) / OSM_TILE_SIZE))))
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]
      .map(([x, y]) => mapProjection.invert?.([(x - mapPan[0]) / mapZoom, (y - mapPan[1]) / mapZoom]))
      .filter((coordinate): coordinate is [number, number] => Boolean(coordinate))
    const lons = corners.map((coordinate) => coordinate[0])
    const lats = corners.map((coordinate) => coordinate[1])
    const minLon = Math.max(-10.8, Math.min(...lons) - 0.4)
    const maxLon = Math.min(3.4, Math.max(...lons) + 0.4)
    const minLat = Math.max(49.2, Math.min(...lats) - 0.4)
    const maxLat = Math.min(61.5, Math.max(...lats) + 0.4)
    const minX = tileXForLon(minLon, z)
    const maxX = tileXForLon(maxLon, z)
    const minY = tileYForLat(maxLat, z)
    const maxY = tileYForLat(minLat, z)
    const maxTile = 2 ** z - 1
    const tiles: Tile[] = []

    for (let x = Math.max(0, minX); x <= Math.min(maxTile, maxX); x += 1) {
      for (let y = Math.max(0, minY); y <= Math.min(maxTile, maxY); y += 1) {
        const topLeft = mapProjection([lonForTileX(x, z), latForTileY(y, z)]) as [number, number]
        const bottomRight = mapProjection([lonForTileX(x + 1, z), latForTileY(y + 1, z)]) as [number, number]
        tiles.push({
          z,
          x,
          y,
          href: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
          topLeft,
          bottomRight,
        })
      }
    }

    return tiles
  }

  function areaBoundaryClass(area: BuiltUpAreaFeature): string {
    const code = area.properties.code
    const solved = solvedAreaCodes.has(code)
    const extra = extraFoundAreaCodes.has(code)

    return [
      'area-boundary',
      area.properties.isTop100 ? 'area-boundary--quiz' : 'area-boundary--extra',
      solved ? 'area-boundary--solved' : 'area-boundary--unsolved',
      revealedAreaCodes.has(code) ? 'area-boundary--revealed' : '',
      extra ? 'area-boundary--extra-found' : '',
      hoveredAreaCode === code ? 'area-boundary--hovered' : '',
    ].filter(Boolean).join(' ')
  }

  function renderHoverState(): void {
    const bounds = mapFrame.getBoundingClientRect()
    const width = Math.max(1, bounds.width)
    const height = Math.max(1, bounds.height)
    const svg = select(mapFrame).select<SVGSVGElement>('svg.uk-map')

    if (svg.empty()) {
      return
    }

    svg
      .selectAll<SVGPathElement, BuiltUpAreaFeature>('path.area-boundary')
      .attr('class', areaBoundaryClass)

    renderMapTooltip(width, height)
  }

  function renderMapTooltip(width: number, height: number): void {
    const hoveredArea = hoveredAreaCode ? areaByCode.get(hoveredAreaCode) : null
    const svg = select(mapFrame).select<SVGSVGElement>('svg.uk-map')

    svg
      .selectAll<SVGGElement, BuiltUpAreaFeature>('g.map-tooltip')
      .data(hoveredArea && tooltipPoint ? [hoveredArea] : [], (area) => area.properties.code)
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
        const [x, y] = tooltipPoint ?? [0, 0]
        return `translate(${Math.min(width - 220, Math.max(18, x + 14))} ${Math.min(height - 38, Math.max(18, y - 40))})`
      })
      .each(function (area) {
        const group = select(this)
        const code = area.properties.code
        const canShowName = solvedAreaCodes.has(code) || revealedAreaCodes.has(code) || extraFoundAreaCodes.has(code)
        const hasClue = cluedAreaCodes.has(code)
        const label = canShowName
          ? `${area.properties.name} · ${formatNumber(area.properties.population)}`
          : hasClue
            ? `Starts with ${area.properties.name[0]?.toUpperCase() ?? '?'} · Population ${formatNumber(area.properties.population)}`
          : `Population ${formatNumber(area.properties.population)}`
        const text = group.select<SVGTextElement>('text')
          .attr('x', 10)
          .attr('y', 18)
          .text(label)

        const textLength = text.node()?.getComputedTextLength() ?? 100
        group.select<SVGRectElement>('rect')
          .attr('width', textLength + 20)
          .attr('height', 28)
      })
  }

  function renderMap(): void {
    const bounds = mapFrame.getBoundingClientRect()
    const width = Math.max(1, bounds.width)
    const height = Math.max(1, bounds.height)

    mapFrame.dataset.tilesVisible = quizFinished ? 'true' : 'false'
    mapProjection = geoMercator()
      .fitExtent(
        [
          [MAP_PADDING, MAP_PADDING],
          [width - MAP_PADDING, height - MAP_PADDING],
        ],
        mapFitAreaData as unknown as GeoPermissibleObjects,
      )

    const mapPath = geoPath(mapProjection)
    const svg = select(mapFrame)
      .selectAll<SVGSVGElement, null>('svg')
      .data([null])
      .join('svg')
      .attr('class', 'uk-map')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Map of Great Britain with county borders and built-up area boundaries')

    const viewport = svg
      .selectAll<SVGGElement, null>('g.map-viewport')
      .data([null])
      .join('g')
      .attr('class', 'map-viewport')
      .attr('transform', `translate(${mapPan[0]} ${mapPan[1]}) scale(${mapZoom})`)

    viewport
      .selectAll<SVGImageElement, Tile>('image.osm-tile')
      .data(createTiles(width, height), (tile) => `${tile.z}/${tile.x}/${tile.y}`)
      .join('image')
      .attr('class', 'osm-tile')
      .attr('href', (tile) => tile.href)
      .attr('x', (tile) => tile.topLeft[0])
      .attr('y', (tile) => tile.topLeft[1])
      .attr('width', (tile) => tile.bottomRight[0] - tile.topLeft[0])
      .attr('height', (tile) => tile.bottomRight[1] - tile.topLeft[1])
      .attr('preserveAspectRatio', 'none')
      .lower()

    viewport
      .selectAll<SVGPathElement, BoundaryFeature>('path.country-boundary')
      .data(countryBoundaryData.features, (feature) => feature.properties?.ctry18nm ?? '')
      .join('path')
      .attr('class', 'country-boundary')
      .attr('data-country', (feature) => feature.properties?.ctry18nm ?? '')
      .attr('d', (feature) => mapPath(feature) ?? '')

    viewport
      .selectAll<SVGTextElement, BoundaryFeature>('text.county-label')
      .data(showCountyNames ? countyBoundaryData.features : [], (feature) => feature.properties?.CTYUA23CD ?? '')
      .join('text')
      .attr('class', 'county-label')
      .attr('pointer-events', 'none')
      .attr('aria-hidden', 'true')
      .each(function renderLabel(feature) {
        renderCountyLabel(this, feature, mapPath)
      })

    viewport
      .selectAll<SVGPathElement, BoundaryFeature>('path.county-boundary')
      .data(countyBoundaryData.features, (feature) => feature.properties?.CTYUA23CD ?? '')
      .join('path')
      .attr('class', 'county-boundary')
      .attr('data-county', (feature) => feature.properties?.CTYUA23NM ?? '')
      .attr('d', (feature) => mapPath(feature) ?? '')

    viewport
      .selectAll<SVGPathElement, BuiltUpAreaFeature>('path.area-boundary')
      .data(visibleAreaFeatures(), (area) => area.properties.code)
      .join('path')
      .attr('class', areaBoundaryClass)
      .attr('data-area-code', (area) => area.properties.code)
      .attr('data-area-name', (area) => area.properties.name)
      .attr('d', (area) => mapPath(area as unknown as GeoPermissibleObjects) ?? '')
      .on('pointerdown', (event) => {
        event.stopPropagation()
      })
      .on('click', (event, area) => {
        if (!area.properties.isTop100 || solvedAreaCodes.has(area.properties.code) || quizFinished) {
          return
        }

        event.preventDefault()
        event.stopPropagation()

        if (event.shiftKey) {
          solveArea(area.properties.code, 'reveal')
          return
        }

        cluedAreaCodes.add(area.properties.code)
        hoveredAreaCode = area.properties.code
        tooltipPoint = pointer(event, mapFrame) as [number, number]
        renderHoverState()
      })
      .on('pointerenter', (event, area) => {
        hoveredAreaCode = area.properties.code
        tooltipPoint = pointer(event, mapFrame) as [number, number]
        renderHoverState()
      })
      .on('pointermove', (event) => {
        tooltipPoint = pointer(event, mapFrame) as [number, number]
        renderHoverState()
      })
      .on('pointerleave', () => {
        hoveredAreaCode = null
        tooltipPoint = null
        renderHoverState()
      })

    viewport
      .selectAll<SVGTextElement, BuiltUpAreaFeature>('text.city-label')
      .data(showCityLabels && !quizFinished ? visibleAreaFeatures().filter((area) => {
        const code = area.properties.code
        return solvedAreaCodes.has(code) || revealedAreaCodes.has(code) || extraFoundAreaCodes.has(code)
      }) : [], (area) => area.properties.code)
      .join('text')
      .attr('class', 'city-label')
      .attr('pointer-events', 'none')
      .attr('aria-hidden', 'true')
      .attr('x', (area) => mapProjection(area.properties.centroid)?.[0] ?? 0)
      .attr('y', (area) => mapProjection(area.properties.centroid)?.[1] ?? 0)
      .style('font-size', `${cityLabelSize / mapZoom}px`)
      .style('stroke-width', `${CITY_LABEL_STROKE_WIDTH / mapZoom}px`)
      .text((area) => area.properties.name)

    renderMapTooltip(width, height)
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

  function solveArea(areaCode: string, source: 'answer' | 'reveal' = 'answer'): void {
    const area = areaByCode.get(areaCode)

    if (!area || quizFinished) {
      return
    }

    if (quizStartedAt === null) {
      quizStartedAt = Date.now()
    }

    answerInput.value = ''

    if (!area.properties.isTop100) {
      if (!isWithinExtraAnswerLimit(area)) {
        renderStatus(`${area.properties.name} is outside the current extra answer limit.`, 'muted')
        return
      }

      if (extraFoundAreaCodes.has(areaCode)) {
        renderStatus(`${area.properties.name} is already marked.`, 'muted')
        return
      }

      extraFoundAreaCodes.add(areaCode)
      hoveredAreaCode = areaCode
      renderMap()
      renderStatus(`${area.properties.name} accepted, but it is outside the top 100.`, 'success')
      return
    }

    if (solvedAreaCodes.has(areaCode)) {
      renderStatus(`${area.properties.name} is already solved.`, 'muted')
      return
    }

    solvedAreaCodes.add(areaCode)

    if (source === 'reveal') {
      revealedAreaCodes.add(areaCode)
    }

    applySlotState(areaCode)
    renderScore()
    scheduleMapRender()

    if (solvedAreaCodes.size === topAreas.length) {
      finishQuiz(true)
      return
    }

    renderStatus(
      source === 'reveal'
        ? `${area.properties.name} revealed.`
        : `${area.properties.name} accepted.`,
      source === 'reveal' ? 'neutral' : 'success',
    )
  }

  function maybeAcceptGuess(): void {
    const normalizedGuess = normalizeAnswer(answerInput.value)

    if (!normalizedGuess || quizFinished) {
      return
    }

    const areaCode = aliasToAreaCode.get(normalizedGuess)

    const area = areaCode ? areaByCode.get(areaCode) : null

    if (areaCode && area?.properties.isTop100 && !solvedAreaCodes.has(areaCode)) {
      solveArea(areaCode)
    }
  }

  function submitGuess(): void {
    const normalizedGuess = normalizeAnswer(answerInput.value)

    if (!normalizedGuess || quizFinished) {
      return
    }

    const areaCode = aliasToAreaCode.get(normalizedGuess)
    const area = areaCode ? areaByCode.get(areaCode) : null

    if (!areaCode || !area) {
      renderStatus('No match yet.', 'muted')
      return
    }

    if (area.properties.isTop100 && solvedAreaCodes.has(areaCode)) {
      renderStatus(`${area.properties.name} is already solved.`, 'muted')
      return
    }

    solveArea(areaCode)
  }

  function revealAll(): void {
    if (quizFinished) {
      return
    }

    for (const area of topAreas) {
      if (!solvedAreaCodes.has(area.properties.code)) {
        solvedAreaCodes.add(area.properties.code)
        revealedAreaCodes.add(area.properties.code)
        applySlotState(area.properties.code)
      }
    }

    finishQuiz(false)
  }

  function finishQuiz(celebrate: boolean): void {
    quizFinished = true
    turnOffCityLabels()
    window.clearInterval(intervalHandle)
    answerInput.disabled = true
    giveUpButton.disabled = true
    const elapsed = formatTime(elapsedMilliseconds())
    const revealedCount = revealedAreaCodes.size
    const extraCount = extraFoundAreaCodes.size
    const message = celebrate
      ? `All ${topAreas.length} places found in ${elapsed}${revealedCount ? `, with ${revealedCount} revealed` : ''}${extraCount ? `, plus ${extraCount} outside the top 100` : ''}.`
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
    hoveredAreaCode = null
    tooltipPoint = null
    mapZoom = 1
    mapPan = [0, 0]
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
  extraAnswerLimitInput.addEventListener('change', updateExtraAnswerRankLimit)
  showCountyNamesInput.addEventListener('change', updateCountyNameSetting)
  showCityLabelsInput.addEventListener('change', updateCityLabelSetting)
  cityLabelSizeInput.addEventListener('input', updateCityLabelSize)
  extraAnswerLimitInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      updateExtraAnswerRankLimit()
      answerInput.focus()
    }
  })
  winCloseButton.addEventListener('click', () => {
    winOverlay.hidden = true
    delete document.body.dataset.winOverlayOpen
    answerInput.focus()
  })

  for (const button of trackerToggleButtons) {
    button.addEventListener('click', () => {
      trackerMode = button.dataset.mode as TrackerMode

      for (const toggleButton of trackerToggleButtons) {
        toggleButton.setAttribute('aria-pressed', String(toggleButton === button))
      }

      renderTracker()
    })
  }

  mapFrame.addEventListener('wheel', (event) => {
    event.preventDefault()
    const factor = Math.exp(-Math.max(-80, Math.min(80, event.deltaY)) * 0.0028)
    const nextZoom = Math.max(0.8, Math.min(6, mapZoom * factor))
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
    if (event.button !== 0 || event.target instanceof Element && event.target.closest('.area-boundary')) {
      return
    }

    mapFrame.setPointerCapture(event.pointerId)
    dragStart = {
      pointerId: event.pointerId,
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

  mapFrame.addEventListener('pointerup', (event) => {
    if (dragStart?.pointerId === event.pointerId && mapFrame.hasPointerCapture(event.pointerId)) {
      mapFrame.releasePointerCapture(event.pointerId)
    }

    dragStart = null
  })

  mapFrame.addEventListener('pointercancel', (event) => {
    if (dragStart?.pointerId === event.pointerId && mapFrame.hasPointerCapture(event.pointerId)) {
      mapFrame.releasePointerCapture(event.pointerId)
    }

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

  extraAnswerLimitInput.value = String(extraAnswerRankLimit)
  showCountyNamesInput.checked = showCountyNames
  showCityLabelsInput.checked = showCityLabels
  syncCityLabelSizeControl()
  syncSettingsUrl()
  renderScore()
  renderTracker()
  renderStatus('')
  renderMap()
  tick()
  answerInput.focus()
}

bootstrap().catch((error: unknown) => {
  console.error(error)
  app.innerHTML = `
    <main class="shell shell--loading">
      <section class="loading-panel">
        <p class="eyebrow">GB Towns & Cities</p>
        <h1>Unable to load boundary data</h1>
        <p class="source-note">${error instanceof Error ? error.message : 'Unknown error'}</p>
      </section>
    </main>
  `
})
