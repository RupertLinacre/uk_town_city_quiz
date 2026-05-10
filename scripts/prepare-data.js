import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { csvParse } from 'd3-dsv'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const paths = {
  osBuiltUpAreas: join(root, 'data/os_open_built_up_areas.csv'),
  oaToBua: join(root, 'data/population/oa21-to-bua24-lookup.csv'),
  censusZip: join(root, 'data/population/census2021-ts001.zip'),
  scotlandSettlements: join(root, 'data/population/scotland-settlements-2022-lookup.csv'),
  counties: join(root, 'src/generated/uk-county-boundaries.json'),
  countries: join(root, 'src/generated/uk-country-boundaries.json'),
  outDir: join(root, 'public/data'),
}

const ENGLISH_CEREMONIAL_COUNTY_BY_ADMIN_AREA = new Map(Object.entries({
  Barnsley: 'South Yorkshire',
  'Bath and North East Somerset': 'Somerset',
  Bedford: 'Bedfordshire',
  Birmingham: 'West Midlands',
  'Blackburn with Darwen': 'Lancashire',
  Blackpool: 'Lancashire',
  Bolton: 'Greater Manchester',
  'Bournemouth, Christchurch and Poole': 'Dorset',
  Bradford: 'West Yorkshire',
  'Bracknell Forest': 'Berkshire',
  'Brighton and Hove': 'East Sussex',
  'Bristol, City of': 'Bristol',
  Bury: 'Greater Manchester',
  Calderdale: 'West Yorkshire',
  'Central Bedfordshire': 'Bedfordshire',
  'Cheshire East': 'Cheshire',
  'Cheshire West and Chester': 'Cheshire',
  Coventry: 'West Midlands',
  Cumberland: 'Cumbria',
  Darlington: 'County Durham',
  Derby: 'Derbyshire',
  Doncaster: 'South Yorkshire',
  Dudley: 'West Midlands',
  Gateshead: 'Tyne and Wear',
  Halton: 'Cheshire',
  Hartlepool: 'County Durham',
  'Herefordshire, County of': 'Herefordshire',
  'Kingston upon Hull, City of': 'East Riding of Yorkshire',
  Kirklees: 'West Yorkshire',
  Knowsley: 'Merseyside',
  Leeds: 'West Yorkshire',
  Leicester: 'Leicestershire',
  Liverpool: 'Merseyside',
  Luton: 'Bedfordshire',
  Manchester: 'Greater Manchester',
  Medway: 'Kent',
  Middlesbrough: 'North Yorkshire',
  'Milton Keynes': 'Buckinghamshire',
  'Newcastle upon Tyne': 'Tyne and Wear',
  'North East Lincolnshire': 'Lincolnshire',
  'North Lincolnshire': 'Lincolnshire',
  'North Northamptonshire': 'Northamptonshire',
  'North Somerset': 'Somerset',
  'North Tyneside': 'Tyne and Wear',
  Nottingham: 'Nottinghamshire',
  Oldham: 'Greater Manchester',
  Peterborough: 'Cambridgeshire',
  Plymouth: 'Devon',
  Portsmouth: 'Hampshire',
  Reading: 'Berkshire',
  'Redcar and Cleveland': 'North Yorkshire',
  Rochdale: 'Greater Manchester',
  Rotherham: 'South Yorkshire',
  Salford: 'Greater Manchester',
  Sandwell: 'West Midlands',
  Sefton: 'Merseyside',
  Sheffield: 'South Yorkshire',
  Shropshire: 'Shropshire',
  Slough: 'Berkshire',
  Solihull: 'West Midlands',
  'South Gloucestershire': 'Gloucestershire',
  'South Tyneside': 'Tyne and Wear',
  Southampton: 'Hampshire',
  'Southend-on-Sea': 'Essex',
  'St. Helens': 'Merseyside',
  Stockport: 'Greater Manchester',
  'Stockton-on-Tees': 'County Durham',
  'Stoke-on-Trent': 'Staffordshire',
  Sunderland: 'Tyne and Wear',
  Swindon: 'Wiltshire',
  Tameside: 'Greater Manchester',
  'Telford and Wrekin': 'Shropshire',
  Thurrock: 'Essex',
  Torbay: 'Devon',
  Trafford: 'Greater Manchester',
  Wakefield: 'West Yorkshire',
  Walsall: 'West Midlands',
  Warrington: 'Cheshire',
  'West Berkshire': 'Berkshire',
  'West Northamptonshire': 'Northamptonshire',
  'Westmorland and Furness': 'Cumbria',
  Wigan: 'Greater Manchester',
  'Windsor and Maidenhead': 'Berkshire',
  Wirral: 'Merseyside',
  Wokingham: 'Berkshire',
  Wolverhampton: 'West Midlands',
  York: 'North Yorkshire',
}))

const LONDON_CODES = new Map([
  ['E63019198', { name: 'Barking and Dagenham', population: 218236 }],
  ['E63019085', { name: 'Barnet', population: 388143 }],
  ['E63019349', { name: 'Bexley', population: 245892 }],
  ['E63019182', { name: 'Brent', population: 340866 }],
  ['E63019512', { name: 'Bromley', population: 324712 }],
  ['E63019201', { name: 'Camden', population: 209342 }],
  ['E63019243', { name: 'City and County of the City of London', population: 7820 }],
  ['E63019250', { name: 'City of Westminster', population: 203262 }],
  ['E63019581', { name: 'Croydon', population: 389242 }],
  ['E63019237', { name: 'Ealing', population: 366952 }],
  ['E63019020', { name: 'Enfield', population: 329822 }],
  ['E63019323', { name: 'Greenwich', population: 287796 }],
  ['E63019186', { name: 'Hackney', population: 258080 }],
  ['E63019295', { name: 'Hammersmith and Fulham', population: 182187 }],
  ['E63019113', { name: 'Haringey', population: 264069 }],
  ['E63019112', { name: 'Harrow', population: 260534 }],
  ['E63019145', { name: 'Havering', population: 259653 }],
  ['E63019221', { name: 'Hillingdon', population: 306028 }],
  ['E63019345', { name: 'Hounslow', population: 286910 }],
  ['E63019196', { name: 'Islington', population: 216751 }],
  ['E63019272', { name: 'Kensington and Chelsea', population: 143348 }],
  ['E63019496', { name: 'Kingston upon Thames', population: 166333 }],
  ['E63019363', { name: 'Lambeth', population: 317108 }],
  ['E63019370', { name: 'Lewisham', population: 300764 }],
  ['E63019458', { name: 'Merton', population: 214931 }],
  ['E63019218', { name: 'Newham', population: 350864 }],
  ['E63019125', { name: 'Redbridge', population: 308268 }],
  ['E63019322', { name: 'Southwark', population: 307076 }],
  ['E63019573', { name: 'Sutton (Sutton)', population: 208858 }],
  ['E63019239', { name: 'Tower Hamlets', population: 310303 }],
  ['E63019110', { name: 'Waltham Forest', population: 278129 }],
  ['E63019369', { name: 'Wandsworth', population: 325268 }],
  ['E63019385', { name: 'Richmond upon Thames', population: 192888 }],
])

const LONDON_POPULATION = [...LONDON_CODES.values()].reduce((sum, row) => sum + row.population, 0)
const ENGLISH_CONSOLIDATIONS = [
  {
    code: 'E63015571',
    name: 'Manchester',
    alternateName: null,
    population: 561672,
    populationYear: 2021,
    populationSource: 'User-provided Manchester built-up area consolidation',
    populationSourceCode: 'E63015571+E63015681',
    aliases: ['Wythenshawe'],
    componentCodes: [
      'E63015571',
      'E63015681',
    ],
  },
]
const ENGLISH_CONSOLIDATION_BY_CODE = new Map(
  ENGLISH_CONSOLIDATIONS.flatMap((group) => group.componentCodes.map((code) => [code, group])),
)
const SCOTTISH_CONSOLIDATIONS = [
  {
    code: 'S450GREATERGLASGOW',
    name: 'Glasgow',
    alternateName: 'Greater Glasgow',
    sourceCode: 'S53000230',
    sourceName: 'Greater Glasgow',
    population: 1023873,
    aliases: ['Greater Glasgow'],
    componentCodes: [
      'S45001999',
      'S45002269',
      'S45001824',
      'S45001715',
      'S45002199',
      'S45002312',
      'S45002328',
      'S45001784',
      'S45001727',
      'S45002247',
      'S45001710',
      'S45002071',
      'S45001954',
      'S45002435',
    ],
  },
  {
    code: 'S450AIRDRIEHAMILTONMOTHERWELL',
    name: 'Airdrie, Hamilton and Motherwell',
    alternateName: null,
    sourceCode: 'S53000011',
    sourceName: 'Aidrie, Hamilton and Motherwell',
    population: 300371,
    aliases: ['Airdrie', 'Hamilton', 'Motherwell'],
    componentCodes: [
      'S45001646',
      'S45001828',
      'S45002030',
      'S45002216',
      'S45001720',
      'S45002466',
      'S45002042',
      'S45001737',
      'S45001747',
    ],
  },
  {
    code: 'S450BONNYBRIDGECROYCUMBERNAULD',
    name: 'Bonnybridge, Croy and Cumbernauld',
    alternateName: null,
    sourceCode: 'S53000064',
    sourceName: 'Bonnybridge, Croy and Cumbernauld',
    population: 78550,
    aliases: ['Bonnybridge', 'Croy', 'Cumbernauld'],
    componentCodes: [
      'S45001744',
      'S45001864',
      'S45001870',
    ],
  },
  {
    code: 'S450BONNYRIGGDALKEITHMAYFIELDGOREBRIDGE',
    name: 'Bonnyrigg, Dalkeith, Mayfield and Gorebridge',
    alternateName: null,
    sourceCode: 'S53000065',
    sourceName: 'Bonnyrigg, Dalkeith, Mayfield and Gorebridge',
    population: 56940,
    aliases: ['Bonnyrigg', 'Dalkeith', 'Gorebridge', 'Mayfield'],
    componentCodes: [
      'S45001745',
      'S45001879',
      'S45002012',
    ],
  },
  {
    code: 'S450GLENROTHESTHORNTON',
    name: 'Glenrothes and Thornton',
    alternateName: null,
    sourceCode: 'S53000226',
    sourceName: 'Glenrothes and Thornton',
    population: 45731,
    aliases: ['Glenrothes', 'Thornton'],
    componentCodes: [
      'S45002010',
      'S45002413',
    ],
  },
  {
    code: 'S450INVERNESSCULLODEN',
    name: 'Inverness',
    alternateName: 'Inverness and Culloden',
    sourceCode: 'S53000256',
    sourceName: 'Inverness and Culloden',
    population: 65053,
    aliases: ['Inbhir Nis', 'Inverness and Culloden', 'Culloden'],
    componentCodes: [
      'S45002049',
      'S45002241',
    ],
  },
  {
    code: 'S450KILWINNINGSALTCOATS',
    name: 'Kilwinning and Saltcoats',
    alternateName: null,
    sourceCode: 'S53000273',
    sourceName: 'Kilwinning and Saltcoats',
    population: 47354,
    aliases: ['Kilwinning', 'Saltcoats'],
    componentCodes: [
      'S45002090',
      'S45002332',
    ],
  },
  {
    code: 'S450KIRKCALDYDYSART',
    name: 'Kirkcaldy',
    alternateName: 'Kirkcaldy and Dysart',
    sourceCode: 'S53000287',
    sourceName: 'Kirkcaldy and Dysart',
    population: 51117,
    aliases: ['Kirkcaldy and Dysart', 'Dysart'],
    componentCodes: [
      'S45002106',
    ],
  },
  {
    code: 'S450METHILLEVENBUCKHAVEN',
    name: 'Methil, Leven and Buckhaven',
    alternateName: null,
    sourceCode: 'S53000344',
    sourceName: 'Methil, Leven and Buckhaven',
    population: 31582,
    aliases: ['Methil', 'Leven', 'Buckhaven'],
    componentCodes: [
      'S45002192',
      'S45002144',
      'S45001769',
    ],
  },
]
const SCOTTISH_CONSOLIDATION_BY_CODE = new Map(
  SCOTTISH_CONSOLIDATIONS.flatMap((group) => group.componentCodes.map((code) => [code, group])),
)
const SIMPLIFY_TOLERANCE_METRES = 85
const QUIZ_BUFFER_METRES = 750
const QUIZ_BUFFER_QUADRANT_SEGMENTS = 3
const QUIZ_SIMPLIFY_TOLERANCE_METRES = 220
const geoJsonReader = new GeoJSONReader()
const geoJsonWriter = new GeoJSONWriter()

function normalizeName(value) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\bst[.]?\b/g, 'saint')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumber(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function rowValue(row, key) {
  return row[key] ?? row[`﻿${key}`] ?? ''
}

function readCsv(path) {
  return csvParse(readFileSync(path, 'utf8'))
}

function readCensusOaCsv() {
  return csvParse(execFileSync('unzip', ['-p', paths.censusZip, 'census2021-ts001-oa.csv'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }))
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI
}

function osGridToWgs84(easting, northing) {
  const a = 6377563.396
  const b = 6356256.909
  const f0 = 0.9996012717
  const lat0 = toRadians(49)
  const lon0 = toRadians(-2)
  const n0 = -100000
  const e0 = 400000
  const e2 = 1 - (b * b) / (a * a)
  const n = (a - b) / (a + b)

  let lat = lat0
  let meridionalArc = 0

  do {
    lat = (northing - n0 - meridionalArc) / (a * f0) + lat
    meridionalArc =
      b *
      f0 *
      ((1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * (lat - lat0) -
        (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(lat - lat0) * Math.cos(lat + lat0) +
        ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0)) -
        (35 / 24) * n ** 3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0)))
  } while (northing - n0 - meridionalArc >= 0.00001)

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const nu = (a * f0) / Math.sqrt(1 - e2 * sinLat ** 2)
  const rho = (a * f0 * (1 - e2)) / (1 - e2 * sinLat ** 2) ** 1.5
  const eta2 = nu / rho - 1
  const tanLat = Math.tan(lat)
  const secLat = 1 / cosLat
  const dE = easting - e0

  const vii = tanLat / (2 * rho * nu)
  const viii = (tanLat / (24 * rho * nu ** 3)) * (5 + 3 * tanLat ** 2 + eta2 - 9 * tanLat ** 2 * eta2)
  const ix = (tanLat / (720 * rho * nu ** 5)) * (61 + 90 * tanLat ** 2 + 45 * tanLat ** 4)
  const x = secLat / nu
  const xi = (secLat / (6 * nu ** 3)) * (nu / rho + 2 * tanLat ** 2)
  const xii = (secLat / (120 * nu ** 5)) * (5 + 28 * tanLat ** 2 + 24 * tanLat ** 4)
  const xiia = (secLat / (5040 * nu ** 7)) * (61 + 662 * tanLat ** 2 + 1320 * tanLat ** 4 + 720 * tanLat ** 6)

  const osgb36Lat = lat - vii * dE ** 2 + viii * dE ** 4 - ix * dE ** 6
  const osgb36Lon = lon0 + x * dE - xi * dE ** 3 + xii * dE ** 5 - xiia * dE ** 7

  return helmertOsgb36ToWgs84(osgb36Lat, osgb36Lon)
}

function helmertOsgb36ToWgs84(lat, lon) {
  const height = 0
  const a1 = 6377563.396
  const b1 = 6356256.909
  const eSq1 = 1 - (b1 * b1) / (a1 * a1)
  const nu1 = a1 / Math.sqrt(1 - eSq1 * Math.sin(lat) ** 2)
  const x1 = (nu1 + height) * Math.cos(lat) * Math.cos(lon)
  const y1 = (nu1 + height) * Math.cos(lat) * Math.sin(lon)
  const z1 = ((1 - eSq1) * nu1 + height) * Math.sin(lat)

  const tx = 446.448
  const ty = -125.157
  const tz = 542.06
  const s = 20.4894 * 1e-6
  const rx = toRadians(0.1502 / 3600)
  const ry = toRadians(0.2470 / 3600)
  const rz = toRadians(0.8421 / 3600)

  const x2 = tx + (1 + s) * x1 + -rz * y1 + ry * z1
  const y2 = ty + rz * x1 + (1 + s) * y1 + -rx * z1
  const z2 = tz + -ry * x1 + rx * y1 + (1 + s) * z1

  const a2 = 6378137
  const b2 = 6356752.3141
  const eSq2 = 1 - (b2 * b2) / (a2 * a2)
  const p = Math.sqrt(x2 * x2 + y2 * y2)
  let phi = Math.atan2(z2, p * (1 - eSq2))
  let previousPhi = 0

  while (Math.abs(phi - previousPhi) > 1e-12) {
    previousPhi = phi
    const nu2 = a2 / Math.sqrt(1 - eSq2 * Math.sin(phi) ** 2)
    phi = Math.atan2(z2 + eSq2 * nu2 * Math.sin(phi), p)
  }

  return [roundCoordinate(toDegrees(Math.atan2(y2, x2))), roundCoordinate(toDegrees(phi))]
}

function roundCoordinate(value) {
  return Math.round(value * 1e6) / 1e6
}

function parseWktGeometry(wkt) {
  const tokens = [...wkt.matchAll(/[A-Z]+|-?\d+(?:\.\d+)?|[(),]/g)].map((match) => match[0])
  let index = 0

  function expect(token) {
    if (tokens[index] !== token) {
      throw new Error(`Expected ${token}, got ${tokens[index]}`)
    }

    index += 1
  }

  function parsePoint() {
    const easting = Number(tokens[index])
    const northing = Number(tokens[index + 1])
    index += 2
    return [easting, northing]
  }

  function parseRing() {
    const ring = []
    expect('(')

    while (tokens[index] !== ')') {
      ring.push(parsePoint())

      if (tokens[index] === ',') {
        index += 1
      }
    }

    expect(')')
    return simplifyRing(removeCollinearPoints(ring), SIMPLIFY_TOLERANCE_METRES)
  }

  function parsePolygon() {
    const polygon = []
    expect('(')

    while (tokens[index] !== ')') {
      polygon.push(parseRing())

      if (tokens[index] === ',') {
        index += 1
      }
    }

    expect(')')
    return polygon
  }

  const type = tokens[index]
  index += 1

  if (type === 'POLYGON') {
    return { type: 'Polygon', coordinates: parsePolygon() }
  }

  if (type !== 'MULTIPOLYGON') {
    throw new Error(`Unsupported WKT geometry: ${type}`)
  }

  const coordinates = []
  expect('(')

  while (tokens[index] !== ')') {
    coordinates.push(parsePolygon())

    if (tokens[index] === ',') {
      index += 1
    }
  }

  expect(')')
  return { type: 'MultiPolygon', coordinates }
}

function removeCollinearPoints(ring) {
  if (ring.length <= 4) {
    return ring
  }

  const simplified = []

  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[(index - 1 + ring.length) % ring.length]
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    const cross =
      (current[0] - previous[0]) * (next[1] - current[1]) -
      (current[1] - previous[1]) * (next[0] - current[0])

    if (Math.abs(cross) > 0.000001) {
      simplified.push(current)
    }
  }

  if (simplified.length > 0) {
    const first = simplified[0]
    const last = simplified[simplified.length - 1]

    if (first[0] !== last[0] || first[1] !== last[1]) {
      simplified.push([...first])
    }
  }

  return simplified.length >= 4 ? simplified : ring
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 5) {
    return ring
  }

  const openRing = pointsEqual(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : [...ring]
  const simplified = simplifyOpenLine([...openRing, openRing[0]], tolerance)
  const closed = pointsEqual(simplified[0], simplified[simplified.length - 1])
    ? simplified
    : [...simplified, simplified[0]]

  return closed.length >= 4 ? closed : ring
}

function simplifyOpenLine(points, tolerance) {
  if (points.length <= 2) {
    return points
  }

  let maxDistance = 0
  let maxIndex = 0
  const start = points[0]
  const end = points[points.length - 1]

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], start, end)

    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = index
    }
  }

  if (maxDistance <= tolerance) {
    return [start, end]
  }

  const left = simplifyOpenLine(points.slice(0, maxIndex + 1), tolerance)
  const right = simplifyOpenLine(points.slice(maxIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]

  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1])
  }

  return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / Math.hypot(dx, dy)
}

function pointsEqual(left, right) {
  return left[0] === right[0] && left[1] === right[1]
}

function transformGeometry(geometry, transformPoint) {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => ring.map(([x, y]) => transformPoint(x, y))),
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([x, y]) => transformPoint(x, y))),
    ),
  }
}

function createQuizGeometry(geometry) {
  const jstsGeometry = geoJsonReader.read(geometry)
  const buffered = BufferOp.bufferOp(jstsGeometry, QUIZ_BUFFER_METRES, QUIZ_BUFFER_QUADRANT_SEGMENTS)
  const simplified = TopologyPreservingSimplifier.simplify(buffered, QUIZ_SIMPLIFY_TOLERANCE_METRES)
  const cleaned = BufferOp.bufferOp(simplified, 0)
  const output = geoJsonWriter.write(cleaned)

  if (output.type !== 'Polygon' && output.type !== 'MultiPolygon') {
    throw new Error(`Expected polygonal quiz geometry, got ${output.type}`)
  }

  return output
}

function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity]

  forEachPoint(geometry, ([x, y]) => {
    bbox[0] = Math.min(bbox[0], x)
    bbox[1] = Math.min(bbox[1], y)
    bbox[2] = Math.max(bbox[2], x)
    bbox[3] = Math.max(bbox[3], y)
  })

  return bbox
}

function geometryPointCount(geometry) {
  let count = 0

  forEachPoint(geometry, () => {
    count += 1
  })

  return count
}

function geometryPartCount(geometry) {
  return geometry.type === 'Polygon' ? 1 : geometry.coordinates.length
}

function forEachPoint(geometry, callback) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) {
        callback(point)
      }
    }
  }
}

function largestRingCentroid(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let bestRing = null
  let bestArea = -Infinity

  for (const polygon of polygons) {
    const ring = polygon[0]
    const area = Math.abs(ringArea(ring))

    if (area > bestArea) {
      bestArea = area
      bestRing = ring
    }
  }

  return ringCentroid(bestRing ?? polygons[0][0])
}

function ringArea(ring) {
  let area = 0

  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }

  return area / 2
}

function ringCentroid(ring) {
  let twiceArea = 0
  let x = 0
  let y = 0

  for (let index = 0; index < ring.length - 1; index += 1) {
    const p1 = ring[index]
    const p2 = ring[index + 1]
    const cross = p1[0] * p2[1] - p2[0] * p1[1]
    twiceArea += cross
    x += (p1[0] + p2[0]) * cross
    y += (p1[1] + p2[1]) * cross
  }

  if (Math.abs(twiceArea) < 0.000001) {
    const totals = ring.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
    return [totals[0] / ring.length, totals[1] / ring.length]
  }

  return [x / (3 * twiceArea), y / (3 * twiceArea)]
}

function pointInFeature(point, feature) {
  const bbox = feature.bbox

  if (point[0] < bbox[0] || point[0] > bbox[2] || point[1] < bbox[1] || point[1] > bbox[3]) {
    return false
  }

  const polygons = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates

  return polygons.some((polygon) => {
    if (!pointInRing(point, polygon[0])) {
      return false
    }

    return !polygon.slice(1).some((ring) => pointInRing(point, ring))
  })
}

function pointInRing(point, ring) {
  const [x, y] = point
  let inside = false

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const xi = ring[index][0]
    const yi = ring[index][1]
    const xj = ring[previousIndex][0]
    const yj = ring[previousIndex][1]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function countryForCode(code) {
  if (code.startsWith('S')) {
    return 'Scotland'
  }

  if (code.startsWith('W')) {
    return 'Wales'
  }

  return 'England'
}

function createPopulationLookups() {
  const oaPopulation = new Map()

  for (const row of readCensusOaCsv()) {
    const population = parseNumber(rowValue(row, 'Residence type: Total; measures: Value'))

    if (population !== null) {
      oaPopulation.set(rowValue(row, 'geography code'), population)
    }
  }

  const byBuaCode = new Map()
  const byBuaName = new Map()

  for (const row of readCsv(paths.oaToBua)) {
    const code = rowValue(row, 'BUA24CD')
    const population = oaPopulation.get(rowValue(row, 'OA21CD')) ?? 0

    if (!code || population === 0) {
      continue
    }

    const existing = byBuaCode.get(code) ?? {
      code,
      name: rowValue(row, 'BUA24NM'),
      welshName: rowValue(row, 'BUA24NMW'),
      lads: new Set(),
      population: 0,
      year: 2021,
      source: 'ONS Census 2021 via OA21 to BUA24 best-fit lookup',
    }

    existing.population += population
    existing.lads.add(normalizeName(rowValue(row, 'LAD24NM')))
    existing.lads.add(normalizeName(rowValue(row, 'LAD24NMW')))
    byBuaCode.set(code, existing)
  }

  for (const record of byBuaCode.values()) {
    for (const name of [record.name, record.welshName]) {
      for (const key of buaNameKeys(name, record)) {
        if (key && (!byBuaName.has(key) || byBuaName.get(key).population < record.population)) {
          byBuaName.set(key, record)
        }
      }
    }
  }

  const byScottishName = new Map()

  for (const row of readCsv(paths.scotlandSettlements)) {
    const population = parseNumber(rowValue(row, 'POPEST2022'))

    if (population === null) {
      continue
    }

    const record = {
      code: rowValue(row, 'SETT_CODE'),
      name: rowValue(row, 'SETT_NAME'),
      population,
      year: 2022,
      source: 'Scottish Government Urban Rural Classification 2022 Census 2022 settlements lookup',
    }

    for (const key of settlementNameKeys(record.name)) {
      if (key && (!byScottishName.has(key) || byScottishName.get(key).population < record.population)) {
        byScottishName.set(key, record)
      }
    }
  }

  return { byBuaCode, byBuaName, byScottishName }
}

function settlementNameKeys(name) {
  const keys = new Set([normalizeName(name)])
  const firstSegment = name.split(',')[0]

  if (firstSegment) {
    keys.add(normalizeName(firstSegment))
  }

  return keys
}

function buaNameKeys(name, record) {
  const keys = new Set([normalizeName(name)])
  const parentheticalMatch = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)

  if (parentheticalMatch) {
    const baseKey = normalizeName(parentheticalMatch[1])
    const disambiguatorKey = normalizeName(parentheticalMatch[2])

    if (disambiguatorKey === baseKey || record.lads.has(disambiguatorKey)) {
      keys.add(baseKey)
    }
  }

  return keys
}

function findPopulation(row, lookups) {
  const code = rowValue(row, 'gsscode')
  const country = countryForCode(code)
  const names = [rowValue(row, 'name1_text'), rowValue(row, 'name2_text')]

  if (country === 'Scotland') {
    for (const name of names) {
      const record = lookups.byScottishName.get(normalizeName(name))

      if (record) {
        return record
      }
    }

    return null
  }

  if (lookups.byBuaCode.has(code)) {
    return lookups.byBuaCode.get(code)
  }

  for (const name of names) {
    const record = findBuaPopulationByName(name, lookups.byBuaName)

    if (record) {
      return record
    }
  }

  return null
}

function findBuaPopulationByName(name, byBuaName) {
  const exactRecord = byBuaName.get(normalizeName(name))

  if (exactRecord) {
    return exactRecord
  }

  const parentheticalMatch = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)

  if (!parentheticalMatch) {
    return null
  }

  const baseKey = normalizeName(parentheticalMatch[1])
  const disambiguatorKey = normalizeName(parentheticalMatch[2])
  const baseRecord = byBuaName.get(baseKey)

  if (!baseRecord) {
    return null
  }

  if (disambiguatorKey === baseKey || baseRecord.lads.has(disambiguatorKey)) {
    return baseRecord
  }

  return null
}

function displayNamesForRow(row) {
  const name1 = rowValue(row, 'name1_text')
  const name2 = rowValue(row, 'name2_text')
  const name1Language = rowValue(row, 'name1_language')
  const name2Language = rowValue(row, 'name2_language')

  if (name2 && name1Language !== 'eng' && name2Language === 'eng') {
    return {
      name: removeDuplicateParenthetical(name2),
      alternateName: name1,
    }
  }

  return {
    name: removeDuplicateParenthetical(name1),
    alternateName: name2 ? removeDuplicateParenthetical(name2) : null,
  }
}

function removeDuplicateParenthetical(name) {
  const match = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)

  if (!match) {
    return name
  }

  return normalizeName(match[1]) === normalizeName(match[2]) ? match[1] : name
}

function createCountyLookup() {
  const countyData = JSON.parse(readFileSync(paths.counties, 'utf8'))

  return countyData.features.map((feature) => ({
    name: feature.properties.CTYUA23NM,
    geometry: feature.geometry,
    bbox: geometryBbox(feature.geometry),
  }))
}

function countyForFeature(feature, counties) {
  if (feature.properties.code === 'E630LONDON') {
    return 'London'
  }

  const point = feature.properties.centroidBritishGrid
  const county = counties.find((candidate) => pointInFeature(point, candidate))

  if (!county) {
    return countryForCode(feature.properties.code)
  }

  return feature.properties.country === 'England'
    ? ENGLISH_CEREMONIAL_COUNTY_BY_ADMIN_AREA.get(county.name) ?? county.name
    : county.name
}

function featureAliases(feature) {
  const aliases = new Set([
    feature.properties.name,
    feature.properties.alternateName,
    ...(feature.properties.manualAliases ?? []),
  ])

  if (feature.properties.name.endsWith(' upon Tyne')) {
    aliases.add(feature.properties.name.replace(' upon Tyne', ''))
  }

  if (feature.properties.name.endsWith(' upon Trent')) {
    aliases.add(feature.properties.name.replace(' upon Trent', ''))
  }

  if (feature.properties.name === 'Kingston upon Hull') {
    aliases.add('Hull')
  }

  return [...aliases].filter(Boolean)
}

function main() {
  mkdirSync(paths.outDir, { recursive: true })
  const lookups = createPopulationLookups()
  const counties = createCountyLookup()
  const rawFeatures = []
  const londonGeometries = []
  const englishConsolidationGeometries = new Map(ENGLISH_CONSOLIDATIONS.map((group) => [group.code, []]))
  const scottishConsolidationGeometries = new Map(SCOTTISH_CONSOLIDATIONS.map((group) => [group.code, []]))
  const geometryStats = {
    inputPoints: 0,
    outputPoints: 0,
    inputParts: 0,
    outputParts: 0,
  }

  for (const row of readCsv(paths.osBuiltUpAreas)) {
    const code = rowValue(row, 'gsscode')
    const { name, alternateName } = displayNamesForRow(row)
    const geometryBritishGrid = parseWktGeometry(rowValue(row, 'geometry'))
    const centroidBritishGrid = largestRingCentroid(geometryBritishGrid)

    if (LONDON_CODES.has(code)) {
      londonGeometries.push(geometryBritishGrid)
      continue
    }

    const englishConsolidation = ENGLISH_CONSOLIDATION_BY_CODE.get(code)

    if (englishConsolidation) {
      englishConsolidationGeometries.get(englishConsolidation.code)?.push(geometryBritishGrid)
      continue
    }

    const scottishConsolidation = SCOTTISH_CONSOLIDATION_BY_CODE.get(code)

    if (scottishConsolidation) {
      scottishConsolidationGeometries.get(scottishConsolidation.code)?.push(geometryBritishGrid)
      continue
    }

    const population = findPopulation(row, lookups)

    rawFeatures.push({
      type: 'Feature',
      properties: {
        code,
        name,
        alternateName,
        areaHectares: parseNumber(rowValue(row, 'areahectares')),
        population: population?.population ?? null,
        populationYear: population?.year ?? null,
        populationSource: population?.source ?? null,
        populationSourceCode: population?.code ?? null,
        country: countryForCode(code),
        centroidBritishGrid,
      },
      geometryBritishGrid,
    })
  }

  if (londonGeometries.length !== LONDON_CODES.size) {
    console.warn(`Expected ${LONDON_CODES.size} London components, found ${londonGeometries.length}`)
  }

  const londonGeometry = {
    type: 'MultiPolygon',
    coordinates: londonGeometries.flatMap((geometry) =>
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates,
    ),
  }

  rawFeatures.push({
    type: 'Feature',
    properties: {
      code: 'E630LONDON',
      name: 'London',
      alternateName: null,
      areaHectares: londonGeometries.reduce((total, geometry) => total + Math.abs(totalGeometryArea(geometry)) / 10000, 0),
      population: LONDON_POPULATION,
      populationYear: 2021,
      populationSource: 'User-provided London built-up area consolidation',
      populationSourceCode: 'E630LONDON',
      country: 'England',
      centroidBritishGrid: largestRingCentroid(londonGeometry),
    },
    geometryBritishGrid: londonGeometry,
  })

  for (const group of ENGLISH_CONSOLIDATIONS) {
    const geometries = englishConsolidationGeometries.get(group.code) ?? []

    if (geometries.length !== group.componentCodes.length) {
      console.warn(`Expected ${group.componentCodes.length} ${group.name} components, found ${geometries.length}`)
    }

    const geometry = {
      type: 'MultiPolygon',
      coordinates: geometries.flatMap((componentGeometry) =>
        componentGeometry.type === 'Polygon' ? [componentGeometry.coordinates] : componentGeometry.coordinates,
      ),
    }

    rawFeatures.push({
      type: 'Feature',
      properties: {
        code: group.code,
        name: group.name,
        alternateName: group.alternateName,
        areaHectares: geometries.reduce((total, componentGeometry) => total + Math.abs(totalGeometryArea(componentGeometry)) / 10000, 0),
        population: group.population,
        populationYear: group.populationYear,
        populationSource: group.populationSource,
        populationSourceCode: group.populationSourceCode,
        country: 'England',
        centroidBritishGrid: largestRingCentroid(geometry),
        manualAliases: group.aliases,
      },
      geometryBritishGrid: geometry,
    })
  }

  for (const group of SCOTTISH_CONSOLIDATIONS) {
    const geometries = scottishConsolidationGeometries.get(group.code) ?? []

    if (geometries.length !== group.componentCodes.length) {
      console.warn(`Expected ${group.componentCodes.length} ${group.name} components, found ${geometries.length}`)
    }

    const geometry = {
      type: 'MultiPolygon',
      coordinates: geometries.flatMap((componentGeometry) =>
        componentGeometry.type === 'Polygon' ? [componentGeometry.coordinates] : componentGeometry.coordinates,
      ),
    }

    rawFeatures.push({
      type: 'Feature',
      properties: {
        code: group.code,
        name: group.name,
        alternateName: group.alternateName,
        areaHectares: geometries.reduce((total, componentGeometry) => total + Math.abs(totalGeometryArea(componentGeometry)) / 10000, 0),
        population: group.population,
        populationYear: 2022,
        populationSource: `Scottish Government Urban Rural Classification 2022 Census 2022 settlements lookup (${group.sourceName})`,
        populationSourceCode: group.sourceCode,
        country: 'Scotland',
        centroidBritishGrid: largestRingCentroid(geometry),
        manualAliases: group.aliases,
      },
      geometryBritishGrid: geometry,
    })
  }

  const populatedFeatures = rawFeatures
    .filter((feature) => feature.properties.population !== null)
    .sort((left, right) => right.properties.population - left.properties.population)
  const top100Codes = new Set(populatedFeatures.slice(0, 100).map((feature) => feature.properties.code))
  const populationRankByCode = new Map(
    populatedFeatures.map((feature, index) => [feature.properties.code, index + 1]),
  )

  const features = rawFeatures
    .map((feature) => {
      const county = countyForFeature(feature, counties)
      const isTop100 = top100Codes.has(feature.properties.code)
      const populationRank = populationRankByCode.get(feature.properties.code) ?? null
      const quizGeometryBritishGrid = createQuizGeometry(feature.geometryBritishGrid)
      const geometry = transformGeometry(quizGeometryBritishGrid, osGridToWgs84)
      const centroid = osGridToWgs84(...largestRingCentroid(quizGeometryBritishGrid))
      const aliases = featureAliases(feature)

      geometryStats.inputPoints += geometryPointCount(feature.geometryBritishGrid)
      geometryStats.outputPoints += geometryPointCount(quizGeometryBritishGrid)
      geometryStats.inputParts += geometryPartCount(feature.geometryBritishGrid)
      geometryStats.outputParts += geometryPartCount(quizGeometryBritishGrid)

      return {
        type: 'Feature',
        properties: {
          code: feature.properties.code,
          name: feature.properties.name,
          alternateName: feature.properties.alternateName,
          aliases,
          areaHectares: feature.properties.areaHectares === null
            ? null
            : Math.round(feature.properties.areaHectares * 100) / 100,
          population: feature.properties.population,
          populationYear: feature.properties.populationYear,
          populationSource: feature.properties.populationSource,
          populationSourceCode: feature.properties.populationSourceCode,
          country: feature.properties.country,
          county,
          centroid,
          isTop100,
          populationRank,
          rank: isTop100 ? populationRank : null,
        },
        geometry,
      }
    })
    .sort((left, right) => {
      const leftPopulation = left.properties.population ?? -1
      const rightPopulation = right.properties.population ?? -1
      return rightPopulation - leftPopulation || left.properties.name.localeCompare(right.properties.name)
    })

  const featureCollection = {
    type: 'FeatureCollection',
    features,
  }

  const index = features.map((feature) => ({
    code: feature.properties.code,
    name: feature.properties.name,
    alternateName: feature.properties.alternateName,
    aliases: feature.properties.aliases,
    population: feature.properties.population,
    country: feature.properties.country,
    county: feature.properties.county,
    isTop100: feature.properties.isTop100,
    populationRank: feature.properties.populationRank,
    rank: feature.properties.rank,
  }))

  writeFileSync(join(paths.outDir, 'built-up-areas.geojson'), `${JSON.stringify(featureCollection)}\n`)
  writeFileSync(join(paths.outDir, 'built-up-areas-index.json'), `${JSON.stringify(index, null, 2)}\n`)
  writeBoundaryData()

  const unmatchedCount = features.filter((feature) => feature.properties.population === null).length
  const matchedCount = features.length - unmatchedCount
  console.log(`Prepared ${features.length} built-up areas in public/data`)
  console.log(
    `Population lookups loaded: ${JSON.stringify({
      bua24: lookups.byBuaCode.size,
      scotlandSettlements: lookups.byScottishName.size,
    })}; matched ${matchedCount}, unmatched ${unmatchedCount}`,
  )
  console.log(
    `Quiz geometry transform: ${geometryStats.inputPoints.toLocaleString('en-GB')} -> ${geometryStats.outputPoints.toLocaleString('en-GB')} points; ${geometryStats.inputParts.toLocaleString('en-GB')} -> ${geometryStats.outputParts.toLocaleString('en-GB')} polygon parts`,
  )
  console.log(`Top 100 starts: ${populatedFeatures.slice(0, 10).map((feature) => feature.properties.name).join(', ')}`)
}

function writeBoundaryData() {
  const countryData = JSON.parse(readFileSync(paths.countries, 'utf8'))
  const countyData = JSON.parse(readFileSync(paths.counties, 'utf8'))
  const gbCountries = {
    type: 'FeatureCollection',
    features: countryData.features
      .filter((feature) => feature.properties.ctry18nm !== 'Northern Ireland')
      .map((feature) => ({
        ...feature,
        geometry: transformGeometry(feature.geometry, osGridToWgs84),
      })),
  }
  const gbCounties = {
    type: 'FeatureCollection',
    features: countyData.features.map((feature) => ({
      ...feature,
      geometry: transformGeometry(feature.geometry, osGridToWgs84),
    })),
  }

  writeFileSync(join(paths.outDir, 'gb-country-boundaries.geojson'), `${JSON.stringify(gbCountries)}\n`)
  writeFileSync(join(paths.outDir, 'gb-county-boundaries.geojson'), `${JSON.stringify(gbCounties)}\n`)
}

function totalGeometryArea(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

  return polygons.reduce((sum, polygon) => {
    const outer = Math.abs(ringArea(polygon[0]))
    const holes = polygon.slice(1).reduce((holeSum, ring) => holeSum + Math.abs(ringArea(ring)), 0)
    return sum + outer - holes
  }, 0)
}

main()
