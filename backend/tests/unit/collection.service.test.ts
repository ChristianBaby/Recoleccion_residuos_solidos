import { registerCollectionRecords } from '../../src/services/collection.service'
import { getWasteByZone } from '../../src/services/report.service'
import { prisma } from '../../src/config/prisma'

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    routeExecution: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    collectionRecord: {
      upsert: jest.fn(),
    },
    zone: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}))

describe('RF-18: Registro de cantidades recolectadas al cierre de ruta', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('registra cantidades por categoría para la ejecución del operador', async () => {
    ;(prisma.routeExecution.findUnique as jest.Mock).mockResolvedValue({
      id: 'exec-1',
      operatorId: 'op-1',
    })
    ;(prisma.collectionRecord.upsert as jest.Mock).mockImplementation(({ create }) =>
      Promise.resolve({ id: 'rec', ...create }),
    )

    const records = await registerCollectionRecords(
      'exec-1',
      [
        { category: 'ORGANIC', quantityKg: 120.5 },
        { category: 'RECYCLABLE', quantityKg: 40 },
      ],
      { id: 'op-1', role: 'OPERATOR' },
    )

    expect(records).toHaveLength(2)
    expect(prisma.collectionRecord.upsert).toHaveBeenCalledTimes(2)
    const firstCall = (prisma.collectionRecord.upsert as jest.Mock).mock.calls[0][0]
    expect(firstCall.where.routeExecutionId_category).toEqual({
      routeExecutionId: 'exec-1',
      category: 'ORGANIC',
    })
    expect(firstCall.create.quantityKg).toBe(120.5)
    // Trazabilidad: guarda quién declaró la cantidad
    expect(firstCall.create.recordedById).toBe('op-1')
  })

  it('rechaza el registro sobre una ejecución de otro operador (403)', async () => {
    ;(prisma.routeExecution.findUnique as jest.Mock).mockResolvedValue({
      id: 'exec-1',
      operatorId: 'op-1',
    })

    await expect(
      registerCollectionRecords('exec-1', [{ category: 'ORGANIC', quantityKg: 10 }], {
        id: 'op-2',
        role: 'OPERATOR',
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(prisma.collectionRecord.upsert).not.toHaveBeenCalled()
  })

  it('permite al ADMIN registrar cantidades de cualquier ejecución', async () => {
    ;(prisma.routeExecution.findUnique as jest.Mock).mockResolvedValue({
      id: 'exec-1',
      operatorId: 'op-1',
    })
    ;(prisma.collectionRecord.upsert as jest.Mock).mockResolvedValue({ id: 'rec' })

    await expect(
      registerCollectionRecords('exec-1', [{ category: 'HAZARDOUS', quantityKg: 5 }], {
        id: 'admin-1',
        role: 'ADMIN',
      }),
    ).resolves.toHaveLength(1)
  })

  it('devuelve 404 si la ejecución no existe', async () => {
    ;(prisma.routeExecution.findUnique as jest.Mock).mockResolvedValue(null)

    await expect(
      registerCollectionRecords('exec-x', [{ category: 'ORGANIC', quantityKg: 10 }], {
        id: 'op-1',
        role: 'OPERATOR',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('los reintentos actualizan la cantidad en lugar de duplicar registros (upsert)', async () => {
    ;(prisma.routeExecution.findUnique as jest.Mock).mockResolvedValue({
      id: 'exec-1',
      operatorId: 'op-1',
    })
    ;(prisma.collectionRecord.upsert as jest.Mock).mockResolvedValue({ id: 'rec' })

    await registerCollectionRecords('exec-1', [{ category: 'ORGANIC', quantityKg: 99 }], {
      id: 'op-1',
      role: 'OPERATOR',
    })

    const call = (prisma.collectionRecord.upsert as jest.Mock).mock.calls[0][0]
    expect(call.update.quantityKg).toBe(99)
  })
})

describe('RF-18: Agregación de kg reales en el reporte RF-14', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const zone = { id: 'zone-1', name: 'Zona 1', district: 'Poroy', color: '#0f766e' }
  const wasteType = {
    wasteType: { id: 'wt-1', name: 'Orgánico', category: 'ORGANIC', colorCode: '#22c55e' },
  }

  it('suma los kg declarados por categoría y cuenta ejecuciones con pesaje', async () => {
    ;(prisma.routeExecution.findMany as jest.Mock).mockResolvedValue([
      {
        route: { zone, routeWasteTypes: [wasteType] },
        collectionRecords: [
          { category: 'ORGANIC', quantityKg: 120.5 },
          { category: 'RECYCLABLE', quantityKg: 30 },
        ],
      },
      {
        route: { zone, routeWasteTypes: [wasteType] },
        collectionRecords: [{ category: 'ORGANIC', quantityKg: 79.5 }],
      },
    ])
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([zone])

    const result = await getWasteByZone({})

    expect(result).toHaveLength(1)
    expect(result[0].executions).toBe(2)
    expect(result[0].weighedExecutions).toBe(2)
    expect(result[0].totalKg).toBe(230)
    const organic = result[0].categories.find((c: { category: string }) => c.category === 'ORGANIC')
    expect(organic?.kg).toBe(200)
  })

  it('mantiene compatibilidad con ejecuciones históricas sin registro de pesaje', async () => {
    ;(prisma.routeExecution.findMany as jest.Mock).mockResolvedValue([
      {
        route: { zone, routeWasteTypes: [wasteType] },
        collectionRecords: [],
      },
    ])
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([zone])

    const result = await getWasteByZone({})

    expect(result[0].executions).toBe(1)
    expect(result[0].weighedExecutions).toBe(0)
    expect(result[0].totalKg).toBe(0)
    const organic = result[0].categories.find((c: { category: string }) => c.category === 'ORGANIC')
    expect(organic?.count).toBe(1)
    expect(organic?.kg).toBe(0)
  })

  it('acumula kg de una categoría no asignada a la ruta (registro extraordinario)', async () => {
    ;(prisma.routeExecution.findMany as jest.Mock).mockResolvedValue([
      {
        route: { zone, routeWasteTypes: [wasteType] },
        collectionRecords: [{ category: 'HAZARDOUS', quantityKg: 12 }],
      },
    ])
    ;(prisma.zone.findMany as jest.Mock).mockResolvedValue([zone])

    const result = await getWasteByZone({})

    const hazardous = result[0].categories.find(
      (c: { category: string }) => c.category === 'HAZARDOUS',
    )
    expect(hazardous).toBeDefined()
    expect(hazardous?.kg).toBe(12)
    expect(result[0].totalKg).toBe(12)
  })
})
