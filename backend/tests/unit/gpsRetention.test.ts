import { cleanupOldGpsTracks, startGpsRetentionJob } from '../../src/services/gpsRetention.service'
import { prisma } from '../../src/config/prisma'

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    gpsTrack: {
      deleteMany: jest.fn(),
    },
  },
}))

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe('RF-08.4 Retención del historial GPS (30 días)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('elimina los puntos GPS con más de 30 días de antigüedad y devuelve el conteo', async () => {
    ;(prisma.gpsTrack.deleteMany as jest.Mock).mockResolvedValue({ count: 42 })

    const before = Date.now()
    const count = await cleanupOldGpsTracks()
    const after = Date.now()

    expect(count).toBe(42)
    expect(prisma.gpsTrack.deleteMany).toHaveBeenCalledTimes(1)

    // El umbral debe ser exactamente "ahora - 30 días" (con tolerancia por el tiempo de ejecución)
    const arg = (prisma.gpsTrack.deleteMany as jest.Mock).mock.calls[0][0]
    const cutoff: Date = arg.where.timestamp.lt
    expect(cutoff).toBeInstanceOf(Date)
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - THIRTY_DAYS_MS)
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - THIRTY_DAYS_MS)
  })

  it('devuelve 0 cuando no hay puntos GPS antiguos que borrar', async () => {
    ;(prisma.gpsTrack.deleteMany as jest.Mock).mockResolvedValue({ count: 0 })

    const count = await cleanupOldGpsTracks()

    expect(count).toBe(0)
  })

  it('startGpsRetentionJob ejecuta la limpieza al arrancar y luego cada 24 horas', () => {
    jest.useFakeTimers()
    try {
      ;(prisma.gpsTrack.deleteMany as jest.Mock).mockResolvedValue({ count: 0 })

      startGpsRetentionJob()

      // Limpieza inmediata al arrancar
      expect(prisma.gpsTrack.deleteMany).toHaveBeenCalledTimes(1)

      // Tras 24 horas se vuelve a ejecutar
      jest.advanceTimersByTime(ONE_DAY_MS)
      expect(prisma.gpsTrack.deleteMany).toHaveBeenCalledTimes(2)

      // Y de nuevo tras otras 24 horas
      jest.advanceTimersByTime(ONE_DAY_MS)
      expect(prisma.gpsTrack.deleteMany).toHaveBeenCalledTimes(3)
    } finally {
      jest.useRealTimers()
    }
  })
})
