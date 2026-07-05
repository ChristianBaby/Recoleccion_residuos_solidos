import { polygonsOverlap, segmentsIntersect } from '../../src/utils/geoUtils';
import { createZone, updateZone } from '../../src/services/zone.service';
import { prisma } from '../../src/config/prisma';
import { logAudit } from '../../src/services/audit.service';
import { sendZoneAssignedEmail } from '../../src/services/email.service';

// Mock de Prisma Client
jest.mock('../../src/config/prisma', () => {
  const mockPrisma: any = {
    zone: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock del servicio de auditoría (RF-03.1)
jest.mock('../../src/services/audit.service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

// Mock del servicio de email (no se envían correos reales en pruebas)
jest.mock('../../src/services/email.service', () => ({
  sendZoneAssignedEmail: jest.fn().mockResolvedValue(undefined),
}));

// ─── Anillos de prueba (formato GeoJSON [lng, lat]) ──────────────────────────

// Cuadrado base: lng [-71.97, -71.95], lat [-13.54, -13.52]
const squareA: [number, number][] = [
  [-71.9700, -13.5200],
  [-71.9500, -13.5200],
  [-71.9500, -13.5400],
  [-71.9700, -13.5400],
  [-71.9700, -13.5200],
];

// Cuadrado que se cruza con A (desplazado a la mitad)
const squareCrossing: [number, number][] = [
  [-71.9600, -13.5300],
  [-71.9400, -13.5300],
  [-71.9400, -13.5500],
  [-71.9600, -13.5500],
  [-71.9600, -13.5300],
];

// Cuadrado pequeño completamente contenido dentro de A
const squareContained: [number, number][] = [
  [-71.9650, -13.5250],
  [-71.9550, -13.5250],
  [-71.9550, -13.5350],
  [-71.9650, -13.5350],
  [-71.9650, -13.5250],
];

// Cuadrado disjunto (lejos de A, al este)
const squareDisjoint: [number, number][] = [
  [-71.9400, -13.5200],
  [-71.9200, -13.5200],
  [-71.9200, -13.5400],
  [-71.9400, -13.5400],
  [-71.9400, -13.5200],
];

const toGeometry = (ring: [number, number][]) => ({
  type: 'Polygon' as const,
  coordinates: [ring] as [number, number][][],
});

describe('Pruebas Unitarias de Geometría - Solapamiento de Polígonos (RF-03.2)', () => {
  it('segmentsIntersect: debe detectar dos segmentos que se cruzan', () => {
    expect(
      segmentsIntersect([-71.97, -13.53], [-71.95, -13.53], [-71.96, -13.52], [-71.96, -13.54]),
    ).toBe(true);
  });

  it('segmentsIntersect: debe retornar false para segmentos separados', () => {
    expect(
      segmentsIntersect([-71.97, -13.52], [-71.95, -13.52], [-71.97, -13.54], [-71.95, -13.54]),
    ).toBe(false);
  });

  it('polygonsOverlap: debe detectar polígonos que se cruzan parcialmente', () => {
    expect(polygonsOverlap(squareA, squareCrossing)).toBe(true);
    expect(polygonsOverlap(squareCrossing, squareA)).toBe(true);
  });

  it('polygonsOverlap: debe detectar un polígono completamente contenido en otro', () => {
    // Ningún segmento se cruza: se detecta por contención de vértices
    expect(polygonsOverlap(squareA, squareContained)).toBe(true);
    expect(polygonsOverlap(squareContained, squareA)).toBe(true);
  });

  it('polygonsOverlap: debe retornar false para polígonos disjuntos', () => {
    expect(polygonsOverlap(squareA, squareDisjoint)).toBe(false);
    expect(polygonsOverlap(squareDisjoint, squareA)).toBe(false);
  });
});

describe('Pruebas de Servicio - Validación de Solapamiento al Crear/Editar Zonas (RF-03.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createZone: debe lanzar 409 si la nueva zona se solapa con una zona activa', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(null); // nombre libre
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-existing', name: 'Zona Existente', geometry: toGeometry(squareA) },
    ]);

    await expect(
      createZone(
        { name: 'Zona Nueva', district: 'Poroy', geometry: toGeometry(squareCrossing) },
        'admin-uuid-001',
      ),
    ).rejects.toEqual({
      status: 409,
      message: 'La zona se solapa con la zona "Zona Existente"',
      details: { conflictZoneId: 'zone-existing' },
    });

    expect(prisma.zone.create).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('createZone: debe crear la zona si su polígono es disjunto de las zonas activas', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-existing', name: 'Zona Existente', geometry: toGeometry(squareA) },
    ]);
    (prisma.zone.create as jest.Mock).mockResolvedValue({
      id: 'zone-new',
      name: 'Zona Nueva',
      district: 'Poroy',
    });

    const result = await createZone(
      { name: 'Zona Nueva', district: 'Poroy', geometry: toGeometry(squareDisjoint) },
      'admin-uuid-001',
    );

    expect(result.id).toBe('zone-new');
    expect(prisma.zone.create).toHaveBeenCalled();
  });

  it('updateZone: debe excluir la propia zona de la comparación de solapamiento', async () => {
    const zoneA = {
      id: 'zone-a',
      name: 'Zona A',
      district: 'Poroy',
      isActive: true,
      geometry: toGeometry(squareA),
    };
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(zoneA);
    // Sin otras zonas activas: la nueva geometría solo "solaparía" consigo misma
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.zone.update as jest.Mock).mockResolvedValue({
      ...zoneA,
      geometry: toGeometry(squareContained),
    });

    const result = await updateZone('zone-a', { geometry: toGeometry(squareContained) }, 'admin-uuid-001');

    expect(result).toBeDefined();
    // La consulta de solapamiento debe excluir la propia zona
    expect(prisma.zone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true, id: { not: 'zone-a' } }),
      }),
    );
    expect(prisma.zone.update).toHaveBeenCalled();
  });

  it('updateZone: debe lanzar 409 si la nueva geometría se solapa con otra zona activa', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue({
      id: 'zone-a',
      name: 'Zona A',
      geometry: toGeometry(squareA),
    });
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([
      { id: 'zone-b', name: 'Zona B', geometry: toGeometry(squareDisjoint) },
    ]);

    await expect(
      updateZone('zone-a', { geometry: toGeometry(squareDisjoint) }, 'admin-uuid-001'),
    ).rejects.toEqual({
      status: 409,
      message: 'La zona se solapa con la zona "Zona B"',
      details: { conflictZoneId: 'zone-b' },
    });

    expect(prisma.zone.update).not.toHaveBeenCalled();
  });
});

describe('Pruebas de Servicio - Reasignación Automática al Editar Geometría (RF-03.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Debe reasignar a los usuarios que quedan fuera y asignar a los pendientes que quedan dentro', async () => {
    const zoneA = {
      id: 'zone-a',
      name: 'Zona A',
      district: 'Poroy',
      isActive: true,
      geometry: toGeometry(squareCrossing), // geometría anterior
    };
    const zoneB = {
      id: 'zone-b',
      name: 'Zona B',
      district: 'Poroy',
      geometry: toGeometry(squareDisjoint), // zona activa vecina, disjunta de la nueva geometría
    };

    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(zoneA);
    // 1ª llamada: validación de solapamiento · 2ª llamada: otras zonas activas para reasignar
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([zoneB]);
    (prisma.zone.update as jest.Mock).mockResolvedValue({
      ...zoneA,
      geometry: toGeometry(squareA), // nueva geometría
    });

    // Usuarios actuales de la zona A (1ª llamada) y pendientes (2ª llamada)
    (prisma.user.findMany as jest.Mock)
      .mockResolvedValueOnce([
        // Sigue dentro de la nueva geometría: no se toca
        { id: 'user-inside', email: 'inside@test.com', firstName: 'Ana', homeLat: -13.53, homeLng: -71.96 },
        // Queda fuera de A pero dentro de la zona B: se reasigna a B
        { id: 'user-to-b', email: 'tob@test.com', firstName: 'Luis', homeLat: -13.53, homeLng: -71.93 },
        // Queda fuera de toda zona activa: pasa a pendiente (zoneId null)
        { id: 'user-lost', email: 'lost@test.com', firstName: 'Rosa', homeLat: -13.60, homeLng: -71.99 },
      ])
      .mockResolvedValueOnce([
        // Pendiente que ahora queda dentro de la nueva geometría de A
        { id: 'user-pending', email: 'pending@test.com', firstName: 'José', homeLat: -13.525, homeLng: -71.955 },
      ]);
    (prisma.user.update as jest.Mock).mockResolvedValue({});

    await updateZone('zone-a', { geometry: toGeometry(squareA) }, 'admin-uuid-001');

    // user-to-b → reasignado a la zona B que contiene su domicilio
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-to-b' },
      data: { zoneId: 'zone-b' },
    });
    // user-lost → sin zona que lo contenga: queda pendiente
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-lost' },
      data: { zoneId: null },
    });
    // user-pending → ahora dentro de la zona A editada
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-pending' },
      data: { zoneId: 'zone-a' },
    });
    // user-inside no se modifica: solo 3 actualizaciones en total
    expect(prisma.user.update).toHaveBeenCalledTimes(3);

    // Notificación por email de las nuevas asignaciones (best-effort)
    expect(sendZoneAssignedEmail).toHaveBeenCalledWith('tob@test.com', 'Luis', 'Zona B', 'Poroy');
    expect(sendZoneAssignedEmail).toHaveBeenCalledWith('pending@test.com', 'José', 'Zona A', 'Poroy');
    expect(sendZoneAssignedEmail).toHaveBeenCalledTimes(2);

    // Criterio ético RF-03.1: la edición queda registrada en auditoría
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-uuid-001',
        action: 'UPDATE',
        entity: 'Zone',
        entityId: 'zone-a',
      }),
    );
  });

  it('No debe recalcular asignaciones si la edición no toca la geometría', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue({
      id: 'zone-a',
      name: 'Zona A',
      geometry: toGeometry(squareA),
    });
    (prisma.zone.update as jest.Mock).mockResolvedValue({ id: 'zone-a', name: 'Zona A Renombrada' });

    await updateZone('zone-a', { description: 'Nueva descripción' }, 'admin-uuid-001');

    expect(prisma.zone.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sendZoneAssignedEmail).not.toHaveBeenCalled();
  });

  it('Un fallo en el envío de email no debe romper la reasignación', async () => {
    const zoneA = {
      id: 'zone-a',
      name: 'Zona A',
      district: 'Poroy',
      isActive: true,
      geometry: toGeometry(squareA),
    };
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(zoneA);
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.zone.update as jest.Mock).mockResolvedValue(zoneA);
    (prisma.user.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'user-pending', email: 'pending@test.com', firstName: 'José', homeLat: -13.53, homeLng: -71.96 },
      ]);
    (prisma.user.update as jest.Mock).mockResolvedValue({});
    (sendZoneAssignedEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP caído'));

    await expect(
      updateZone('zone-a', { geometry: toGeometry(squareA) }, 'admin-uuid-001'),
    ).resolves.toBeDefined();

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-pending' },
      data: { zoneId: 'zone-a' },
    });
  });
});
