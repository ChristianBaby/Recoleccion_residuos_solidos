/**
 * Distancia Haversine entre dos puntos GPS. Retorna metros.
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // radio terrestre en metros
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Ray-casting algorithm para punto-en-polígono.
 * ring está en formato GeoJSON: [lng, lat][]
 */
export function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] // xi=lng, yi=lat
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ─── RF-03.2: Detección de solapamiento entre polígonos ──────────────────────

type Point = [number, number] // formato GeoJSON: [lng, lat]

/**
 * Orientación del triplete (p, q, r):
 * 0 = colineales, 1 = horario, 2 = antihorario.
 */
function orientation(p: Point, q: Point, r: Point): number {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
  if (val === 0) return 0
  return val > 0 ? 1 : 2
}

/** Dado que p, q y r son colineales, indica si q cae sobre el segmento p–r. */
function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) &&
    q[0] >= Math.min(p[0], r[0]) &&
    q[1] <= Math.max(p[1], r[1]) &&
    q[1] >= Math.min(p[1], r[1])
  )
}

/**
 * Indica si el segmento p1–p2 intersecta el segmento p3–p4
 * (incluye casos colineales superpuestos).
 */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orientation(p1, p2, p3)
  const o2 = orientation(p1, p2, p4)
  const o3 = orientation(p3, p4, p1)
  const o4 = orientation(p3, p4, p2)

  // Caso general: los extremos quedan en lados opuestos
  if (o1 !== o2 && o3 !== o4) return true

  // Casos especiales: puntos colineales que caen sobre el otro segmento
  if (o1 === 0 && onSegment(p1, p3, p2)) return true
  if (o2 === 0 && onSegment(p1, p4, p2)) return true
  if (o3 === 0 && onSegment(p3, p1, p4)) return true
  if (o4 === 0 && onSegment(p3, p2, p4)) return true

  return false
}

/**
 * Indica si dos polígonos (anillos GeoJSON [lng, lat][]) se solapan.
 * Hay solapamiento si:
 *  (a) algún segmento de un anillo intersecta un segmento del otro, o
 *  (b) un polígono contiene algún vértice del otro (polígono contenido).
 */
export function polygonsOverlap(ringA: Point[], ringB: Point[]): boolean {
  // (a) Intersección de segmentos entre ambos anillos
  for (let i = 0; i < ringA.length - 1; i++) {
    for (let j = 0; j < ringB.length - 1; j++) {
      if (segmentsIntersect(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) {
        return true
      }
    }
  }

  // (b) Contención: algún vértice de un polígono dentro del otro
  for (const [lng, lat] of ringB) {
    if (pointInPolygon(lat, lng, ringA)) return true
  }
  for (const [lng, lat] of ringA) {
    if (pointInPolygon(lat, lng, ringB)) return true
  }

  return false
}
