import { getCitizenParticipation } from '../../src/services/report.service'
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
  },
}))

describe('RF-16.3: Recomendaciones automáticas por baja participación', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('genera recomendación solo para las zonas con participación bajo el promedio', async () => {
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-1', name: 'Zona Norte', district: 'Cusco', color: '#0f766e' },
      { id: 'zone-2', name: 'Zona Sur', district: 'San Sebastián', color: '#b45309' },
    ])
    // Zona Norte: 3 ciudadanos, 4 incidencias, 5 visitas educativas → índice 12
    // Zona Sur: 0 ciudadanos, 0 incidencias, 0 visitas educativas → índice 0
    // Promedio = 6 → solo Zona Sur queda por debajo
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([
      { zoneId: 'zone-1' },
      { zoneId: 'zone-1' },
      { zoneId: 'zone-1' },
    ])
    ;(prisma.user.count as jest.Mock).mockResolvedValue(3)
    ;(prisma.incident.findMany as jest.Mock).mockResolvedValue([
      { type: 'MISSED_COLLECTION', status: 'OPEN', citizen: { zoneId: 'zone-1' } },
      { type: 'MISSED_COLLECTION', status: 'OPEN', citizen: { zoneId: 'zone-1' } },
      { type: 'WASTE_ACCUMULATION', status: 'RESOLVED', citizen: { zoneId: 'zone-1' } },
      { type: 'OTHER', status: 'CLOSED', citizen: { zoneId: 'zone-1' } },
    ])
    ;(prisma.incident.count as jest.Mock).mockResolvedValue(4)
    ;(prisma.learnVisit.findMany as jest.Mock).mockResolvedValue([
      { zoneId: 'zone-1', userId: 'citizen-1' },
      { zoneId: 'zone-1', userId: 'citizen-1' },
      { zoneId: 'zone-1', userId: 'citizen-2' },
      { zoneId: 'zone-1', userId: 'citizen-2' },
      { zoneId: 'zone-1', userId: 'citizen-3' },
    ])

    const result = await getCitizenParticipation({})

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]).toMatchObject({
      zoneId: 'zone-2',
      zoneName: 'Zona Sur',
      district: 'San Sebastián',
      participationIndex: 0,
      averageIndex: 6,
    })
    // El mensaje debe mencionar la zona y sugerir campaña/taller
    expect(result.recommendations[0].message).toContain('Zona Sur')
    expect(result.recommendations[0].message).toContain('campaña de sensibilización')
    expect(result.recommendations[0].message).toContain('talleres de segregación')
    // La zona con buena participación NO recibe recomendación
    expect(result.recommendations.some((r) => r.zoneId === 'zone-1')).toBe(false)
  })

  it('no genera recomendaciones cuando todas las zonas tienen la misma participación', async () => {
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-1', name: 'Zona Norte', district: 'Cusco', color: '#0f766e' },
      { id: 'zone-2', name: 'Zona Sur', district: 'San Sebastián', color: '#b45309' },
    ])
    // Ambas zonas con índice 2 (1 ciudadano + 1 incidencia) → nadie bajo el promedio
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([
      { zoneId: 'zone-1' },
      { zoneId: 'zone-2' },
    ])
    ;(prisma.user.count as jest.Mock).mockResolvedValue(2)
    ;(prisma.incident.findMany as jest.Mock).mockResolvedValue([
      { type: 'OTHER', status: 'OPEN', citizen: { zoneId: 'zone-1' } },
      { type: 'OTHER', status: 'OPEN', citizen: { zoneId: 'zone-2' } },
    ])
    ;(prisma.incident.count as jest.Mock).mockResolvedValue(2)
    ;(prisma.learnVisit.findMany as jest.Mock).mockResolvedValue([])

    const result = await getCitizenParticipation({})

    expect(result.recommendations).toEqual([])
  })

  it('mantiene el shape existente de la respuesta al añadir recommendations', async () => {
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-1', name: 'Zona Norte', district: 'Cusco', color: '#0f766e' },
    ])
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([{ zoneId: 'zone-1' }])
    ;(prisma.user.count as jest.Mock).mockResolvedValue(1)
    ;(prisma.incident.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.incident.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.learnVisit.findMany as jest.Mock).mockResolvedValue([])

    const result = await getCitizenParticipation({})

    expect(result.summary).toEqual({ totalCitizens: 1, totalIncidents: 0, totalLearnVisits: 0 })
    expect(result.byZone[0]).toMatchObject({
      zoneId: 'zone-1',
      zoneName: 'Zona Norte',
      citizenCount: 1,
      incidents: { total: 0, open: 0, resolved: 0 },
      learnVisits: 0,
      learnUniqueUsers: 0,
    })
    expect(Array.isArray(result.recommendations)).toBe(true)
  })
})
