/**
 * Pruebas de integración RF-11 (HU-11): persistencia y recuperación local
 * de incidencias offline en IndexedDB (src/lib/offlineDb.ts).
 *
 * Se usa `fake-indexeddb` para simular IndexedDB en el entorno de Jest (jsdom).
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  saveOfflineIncident,
  getOfflineIncidents,
  deleteOfflineIncident,
  type OfflineIncident,
} from '@/lib/offlineDb'

// Base limpia antes de cada test: se reemplaza la fábrica global de IndexedDB
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const baseIncident = {
  type: 'UNCOLLECTED_WASTE',
  description: 'Residuos acumulados sin recoger en la esquina del parque',
  address: 'Av. La Cultura 742, Cusco',
  lat: -13.52264,
  lng: -71.96734,
}

describe('offlineDb (RF-11: reporte de incidencias offline)', () => {
  describe('saveOfflineIncident + getOfflineIncidents (persistencia y recuperación)', () => {
    it('guarda un reporte offline y lo recupera con los mismos datos', async () => {
      const id = await saveOfflineIncident(baseIncident)

      const stored = await getOfflineIncidents()

      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject(baseIncident)
      expect(stored[0].id).toBe(id)
    })

    it('genera un id local con prefijo "local_" y una marca de tiempo createdAt ISO', async () => {
      const before = Date.now()
      const id = await saveOfflineIncident(baseIncident)
      const after = Date.now()

      expect(id).toMatch(/^local_\d+_[a-z0-9]+$/)

      const [stored] = await getOfflineIncidents()
      expect(stored.createdAt).toEqual(expect.any(String))
      const createdAtMs = new Date(stored.createdAt).getTime()
      expect(createdAtMs).toBeGreaterThanOrEqual(before)
      expect(createdAtMs).toBeLessThanOrEqual(after)
    })

    it('persiste la imagen comprimida en base64 cuando se incluye', async () => {
      const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ=='
      await saveOfflineIncident({ ...baseIncident, base64Image })

      const [stored] = await getOfflineIncidents()
      expect(stored.base64Image).toBe(base64Image)
    })

    it('permite guardar un reporte sin campos opcionales (address, lat, lng, imagen)', async () => {
      await saveOfflineIncident({
        type: 'CONTAINER_DAMAGED',
        description: 'Contenedor con la tapa rota desde hace una semana',
      })

      const [stored] = await getOfflineIncidents()
      expect(stored.address).toBeUndefined()
      expect(stored.lat).toBeUndefined()
      expect(stored.lng).toBeUndefined()
      expect(stored.base64Image).toBeUndefined()
    })

    it('guarda varios reportes con ids únicos y los recupera todos', async () => {
      const ids = await Promise.all([
        saveOfflineIncident({ ...baseIncident, description: 'Primer reporte offline de prueba' }),
        saveOfflineIncident({ ...baseIncident, description: 'Segundo reporte offline de prueba' }),
        saveOfflineIncident({ ...baseIncident, description: 'Tercer reporte offline de prueba' }),
      ])

      expect(new Set(ids).size).toBe(3)

      const stored = await getOfflineIncidents()
      expect(stored).toHaveLength(3)
      expect(stored.map((i) => i.id).sort()).toEqual([...ids].sort())
    })

    it('devuelve una lista vacía cuando no hay reportes pendientes', async () => {
      await expect(getOfflineIncidents()).resolves.toEqual([])
    })

    it('los datos sobreviven a una nueva apertura de la base (persistencia entre sesiones)', async () => {
      // Cada llamada a las funciones del módulo abre la BD de nuevo, simulando
      // que el usuario cierra y reabre la app sin conexión.
      const id = await saveOfflineIncident(baseIncident)

      const firstRead = await getOfflineIncidents()
      const secondRead = await getOfflineIncidents()

      expect(firstRead).toEqual(secondRead)
      expect(secondRead[0].id).toBe(id)
    })
  })

  describe('deleteOfflineIncident (limpieza tras sincronizar)', () => {
    it('elimina un reporte tras sincronizarlo con el backend', async () => {
      const id = await saveOfflineIncident(baseIncident)

      await deleteOfflineIncident(id)

      await expect(getOfflineIncidents()).resolves.toEqual([])
    })

    it('elimina solo el reporte sincronizado y conserva los pendientes', async () => {
      const syncedId = await saveOfflineIncident({
        ...baseIncident,
        description: 'Reporte que ya fue sincronizado con el servidor',
      })
      const pendingId = await saveOfflineIncident({
        ...baseIncident,
        description: 'Reporte que sigue pendiente de sincronización',
      })

      await deleteOfflineIncident(syncedId)

      const remaining = await getOfflineIncidents()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(pendingId)
    })

    it('no falla al eliminar un id inexistente (delete es idempotente en IndexedDB)', async () => {
      await expect(deleteOfflineIncident('local_no_existe')).resolves.toBeUndefined()
    })
  })

  describe('descarte de reportes inválidos guardados en IndexedDB', () => {
    // El flujo de sincronización (dashboard/incidents/page.tsx) descarta con
    // deleteOfflineIncident(item.id!) los reportes que el backend rechaza con
    // 400 (p. ej. descripción demasiado corta). Aquí se prueba la parte de
    // persistencia de ese flujo: descartar el registro inválido de IndexedDB
    // sin afectar a los válidos.
    it('descarta de IndexedDB un reporte inválido rechazado por el backend y conserva los válidos', async () => {
      const invalidId = await saveOfflineIncident({
        type: 'OTHER',
        description: 'corta', // < 10 caracteres: el backend lo rechazaría con 400
      })
      const validId = await saveOfflineIncident(baseIncident)

      // Simulación del bucle de sincronización: el backend responde 400 para
      // el reporte inválido y este se descarta del almacenamiento local.
      const pending = await getOfflineIncidents()
      const isValid = (incident: OfflineIncident) => incident.description.trim().length >= 10
      for (const incident of pending) {
        if (!isValid(incident)) {
          await deleteOfflineIncident(incident.id!)
        }
      }

      const remaining = await getOfflineIncidents()
      expect(remaining.map((i) => i.id)).toEqual([validId])
      expect(remaining.map((i) => i.id)).not.toContain(invalidId)
    })
  })
})
