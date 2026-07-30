import { getRouteCompliance } from '../../src/services/report.service'
import { prisma } from '../../src/config/prisma'

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    zone: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    incident: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    learnVisit: {
      findMany: jest.fn(),
    },
    route: {
      findMany: jest.fn(),
    },
    routeExecution: {
      findMany: jest.fn(),
    },
    gpsTrack: {
      findMany: jest.fn(),
    },
  },
}))

// ─── RF-15: Cumplimiento de rutas ─────────────────────────────────────────────

describe('RF-15 Reporte de cumplimiento de rutas (getRouteCompliance)', () => {
  const zonePoroy = { id: 'zone-1', name: 'Poroy Centro', district: 'Poroy', color: '#0f766e' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calcula el porcentaje de cumplimiento y las paradas omitidas segun los waypoints visitados', async () => {
    ;(prisma.route.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'route-1',
        name: 'Ruta Poroy Norte',
        dayOfWeek: [1, 3],
        zone: zonePoroy,
        operator: { id: 'op-01', firstName: 'Mario', lastName: 'Vargas' },
        vehicle: { id: 'veh-01', plate: 'X1Y-234', type: 'COMPACTOR' },
        waypoints: [
          { id: 'wp-1', lat: -13.53, lng: -71.96, name: 'Plaza' },
          { id: 'wp-2', lat: -13.6, lng: -72.1, name: 'Mercado' },
        ],
        executions: [
          { id: 'exec-1', status: 'COMPLETED', delayMinutes: 10, startedAt: null, endedAt: null, date: new Date('2026-06-01') },
          { id: 'exec-2', status: 'DELAYED', delayMinutes: 30, startedAt: null, endedAt: null, date: new Date('2026-06-03') },
        ],
      },
    ])
    // Solo la ejecucion 1 pasó por el waypoint 1 (misma coordenada => distancia 0 <= 50 m)
    ;(prisma.gpsTrack.findMany as jest.Mock).mockResolvedValue([
      { routeExecutionId: 'exec-1', lat: -13.53, lng: -71.96 },
    ])

    const result = await getRouteCompliance({})

    expect(result).toHaveLength(1)
    const r = result[0]

    // 1 de 2 ejecuciones completada => 50% de cumplimiento
    expect(r.totalExecutions).toBe(2)
    expect(r.completed).toBe(1)
    expect(r.delayed).toBe(1)
    expect(r.compliancePct).toBe(50)
    // Retraso promedio: (10 + 30) / 2 = 20 minutos
    expect(r.avgDelayMinutes).toBe(20)

    // 2 waypoints x 2 ejecuciones = 4 visitas esperadas; solo 1 registrada => 3 omitidas (75%)
    expect(r.totalWaypoints).toBe(2)
    expect(r.missedStopsTotal).toBe(3)
    expect(r.missedStopsPct).toBe(75)

    // Los tracks GPS se consultan en lote para todas las ejecuciones
    expect(prisma.gpsTrack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { routeExecutionId: { in: ['exec-1', 'exec-2'] } },
      }),
    )
  })

  it('aplica los filtros de zona y fechas, y devuelve 0% cuando no hay ejecuciones', async () => {
    ;(prisma.route.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'route-2',
        name: 'Ruta sin actividad',
        dayOfWeek: [5],
        zone: zonePoroy,
        operator: null,
        vehicle: null,
        waypoints: [{ id: 'wp-1', lat: -13.53, lng: -71.96, name: 'Plaza' }],
        executions: [],
      },
    ])

    const from = '2026-06-01'
    const to = '2026-06-10'
    const result = await getRouteCompliance({ from, to, zoneId: 'zone-1' })

    const expectedTo = new Date(to)
    expectedTo.setHours(23, 59, 59, 999)

    // Solo rutas ACTIVAS de la zona filtrada, con ejecuciones dentro del rango
    expect(prisma.route.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', zoneId: 'zone-1' },
        include: expect.objectContaining({
          executions: expect.objectContaining({
            where: { date: { gte: new Date(from), lte: expectedTo } },
          }),
        }),
      }),
    )

    // Sin ejecuciones no se consultan tracks GPS ni se divide entre cero
    expect(prisma.gpsTrack.findMany).not.toHaveBeenCalled()
    expect(result[0]).toMatchObject({
      totalExecutions: 0,
      compliancePct: 0,
      missedStopsTotal: 0,
      missedStopsPct: 0,
    })
  })
})

