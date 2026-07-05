/**
 * Pruebas unitarias de las utilidades geográficas puras (src/lib/geoUtils.ts):
 * conversión entre vértices [lat, lng][] y polígonos GeoJSON ([lng, lat][]).
 */
import { verticesToGeoJson, geoJsonToVertices } from '@/lib/geoUtils'
import type { GeoJsonPolygon } from '@/types'

describe('geoUtils', () => {
  const triangleVertices: [number, number][] = [
    [-13.52, -71.97],
    [-13.53, -71.96],
    [-13.51, -71.95],
  ]

  describe('verticesToGeoJson', () => {
    it('devuelve null con menos de 3 vértices (no forma un polígono)', () => {
      expect(verticesToGeoJson([])).toBeNull()
      expect(verticesToGeoJson([[-13.52, -71.97]])).toBeNull()
      expect(
        verticesToGeoJson([
          [-13.52, -71.97],
          [-13.53, -71.96],
        ])
      ).toBeNull()
    })

    it('convierte vértices [lat, lng] a un Polygon GeoJSON [lng, lat]', () => {
      const geo = verticesToGeoJson(triangleVertices)

      expect(geo).not.toBeNull()
      expect(geo!.type).toBe('Polygon')
      expect(geo!.coordinates).toHaveLength(1)

      const ring = geo!.coordinates[0]
      // Invierte el orden: [lat, lng] -> [lng, lat]
      expect(ring[0]).toEqual([-71.97, -13.52])
      expect(ring[1]).toEqual([-71.96, -13.53])
      expect(ring[2]).toEqual([-71.95, -13.51])
    })

    it('cierra el anillo repitiendo el primer punto al final', () => {
      const geo = verticesToGeoJson(triangleVertices)!
      const ring = geo.coordinates[0]

      expect(ring).toHaveLength(triangleVertices.length + 1)
      expect(ring[ring.length - 1]).toEqual(ring[0])
    })
  })

  describe('geoJsonToVertices', () => {
    it('convierte un Polygon GeoJSON [lng, lat] a vértices [lat, lng] sin el punto de cierre', () => {
      const geo: GeoJsonPolygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-71.97, -13.52],
            [-71.96, -13.53],
            [-71.95, -13.51],
            [-71.97, -13.52], // cierre del anillo
          ],
        ],
      }

      expect(geoJsonToVertices(geo)).toEqual(triangleVertices)
    })

    it('es la inversa de verticesToGeoJson (round-trip sin pérdidas)', () => {
      const geo = verticesToGeoJson(triangleVertices)!
      expect(geoJsonToVertices(geo)).toEqual(triangleVertices)
    })
  })
})
