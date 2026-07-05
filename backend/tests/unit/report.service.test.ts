import { getCitizenParticipation, getWasteByZone, getRouteCompliance } from '../../src/services/report.service'
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

describe('Reporte de participacion ciudadana', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('aplica el rango de fechas al resumen y al detalle por zona', async () => {
    const from = '2026-06-01'
    const to = '2026-06-10'

    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-1', name: 'Zona 1', district: 'Poroy', color: '#0f766e' },
    ])
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([{ zoneId: 'zone-1' }])
    ;(prisma.user.count as jest.Mock).mockImplementation(({ where }) =>
      where?.createdAt ? 1 : 2,
    )
    ;(prisma.incident.findMany as jest.Mock).mockResolvedValue([
      {
        type: 'MISSED_COLLECTION',
        status: 'OPEN',
        citizen: { zoneId: 'zone-1' },
      },
    ])
    ;(prisma.incident.count as jest.Mock).mockImplementation((args) =>
      args?.where?.createdAt ? 1 : 2,
    )
    ;(prisma.learnVisit.findMany as jest.Mock).mockResolvedValue([
      { zoneId: 'zone-1', userId: 'citizen-1' },
    ])

    const result = await getCitizenParticipation({ from, to })

    expect(result.summary.totalCitizens).toBe(1)
    expect(result.summary.totalIncidents).toBe(1)
    expect(result.summary.totalLearnVisits).toBe(1)
    expect(result.byZone[0]).toMatchObject({
      citizenCount: 1,
      incidents: { total: 1, open: 1, resolved: 0 },
      learnVisits: 1,
      learnUniqueUsers: 1,
    })
  })
})

// ─── RF-14: Residuos recolectados por zona ────────────────────────────────────

describe('RF-14 Reporte de residuos recolectados por zona (getWasteByZone)', () => {
  const zonePoroy = { id: 'zone-1', name: 'Poroy Centro', district: 'Poroy', color: '#0f766e' }
  const zoneSur = { id: 'zone-2', name: 'Poroy Sur', district: 'Poroy', color: '#7c3aed' }

  const wtOrganico = { id: 'wt-1', name: 'Organico', category: 'ORGANIC', colorCode: '#22c55e' }
  const wtReciclable = { id: 'wt-2', name: 'Reciclable', category: 'RECYCLABLE', colorCode: '#3b82f6' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('agrega las ejecuciones por zona y cuenta los residuos por categoria, con ceros para zonas sin actividad', async () => {
    // Dos ejecuciones en zone-1: ambas con organico, solo una con reciclable
    ;(prisma.routeExecution.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'exec-1',
        route: {
          zone: zonePoroy,
          routeWasteTypes: [{ wasteType: wtOrganico }, { wasteType: wtReciclable }],
        },
      },
      {
        id: 'exec-2',
        route: {
          zone: zonePoroy,
          routeWasteTypes: [{ wasteType: wtOrganico }],
        },
      },
    ])
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([zonePoroy, zoneSur])

    const result = await getWasteByZone({})

    expect(result).toHaveLength(2)

    const poroy = result.find((z) => z.zoneId === 'zone-1')!
    expect(poroy.zoneName).toBe('Poroy Centro')
    expect(poroy.executions).toBe(2)
    expect(poroy.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'ORGANIC', name: 'Organico', count: 2 }),
        expect.objectContaining({ category: 'RECYCLABLE', name: 'Reciclable', count: 1 }),
      ]),
    )

    // La zona sin ejecuciones aparece con valores en cero
    const sur = result.find((z) => z.zoneId === 'zone-2')!
    expect(sur.executions).toBe(0)
    expect(sur.categories).toEqual([])

    // Sin filtros no se restringe por fecha ni por zona
    expect(prisma.routeExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
    expect(prisma.zone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    )
  })

  it('aplica los filtros de rango de fechas y de zona en las consultas', async () => {
    ;(prisma.routeExecution.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([zonePoroy])

    const from = '2026-06-01'
    const to = '2026-06-10'
    const result = await getWasteByZone({ from, to, zoneId: 'zone-1' })

    const expectedTo = new Date(to)
    expectedTo.setHours(23, 59, 59, 999)

    expect(prisma.routeExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: { gte: new Date(from), lte: expectedTo },
          route: { zoneId: 'zone-1' },
        },
      }),
    )
    expect(prisma.zone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, id: 'zone-1' } }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ zoneId: 'zone-1', executions: 0, categories: [] })
  })
})

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
