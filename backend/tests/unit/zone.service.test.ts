import { pointInPolygon } from '../../src/utils/geoUtils';
import { createZone, deleteZone } from '../../src/services/zone.service';
import { prisma } from '../../src/config/prisma';
import { logAudit } from '../../src/services/audit.service';

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

describe('Pruebas Unitarias de Geolocalización - Punto en Polígono (HU-01 y HU-03)', () => {
  const testPolygonRing: [number, number][] = [
    [-71.9700, -13.5200],
    [-71.9500, -13.5200],
    [-71.9500, -13.5400],
    [-71.9700, -13.5400],
    [-71.9700, -13.5200],
  ];

  it('Debe retornar true si el punto (coordenadas del ciudadano) está dentro del polígono', () => {
    const latInside = -13.5300;
    const lngInside = -71.9600;
    const result = pointInPolygon(latInside, lngInside, testPolygonRing);
    expect(result).toBe(true);
  });

  it('Debe retornar false si el punto está fuera del polígono (al norte)', () => {
    const latOutside = -13.5000;
    const lngOutside = -71.9600;
    const result = pointInPolygon(latOutside, lngOutside, testPolygonRing);
    expect(result).toBe(false);
  });

  it('Debe retornar false si el punto está fuera del polígono (al este)', () => {
    const latOutside = -13.5300;
    const lngOutside = -71.9400;
    const result = pointInPolygon(latOutside, lngOutside, testPolygonRing);
    expect(result).toBe(false);
  });
});

describe('Pruebas de Servicio CRUD de Zonas - Reglas de Negocio (HU-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Debe crear la zona exitosamente si el nombre no existe', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(null);
    // Sin zonas activas existentes: no hay solapamiento posible
    (prisma.zone.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.zone.create as jest.Mock).mockResolvedValue({
      id: 'zone-123',
      name: 'Zona Cusco Centro',
      district: 'Cusco',
    });

    const input = {
      name: 'Zona Cusco Centro',
      description: 'Sector histórico de Cusco',
      district: 'Cusco',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-71.9700, -13.5200],
            [-71.9500, -13.5200],
            [-71.9500, -13.5400],
            [-71.9700, -13.5400],
            [-71.9700, -13.5200],
          ] as [number, number][],
        ] as [number, number][][],
      },
    };

    const result = await createZone(input, 'admin-uuid-001');

    expect(result).toBeDefined();
    expect(result.name).toBe('Zona Cusco Centro');
    expect(prisma.zone.create).toHaveBeenCalledWith({
      data: {
        name: input.name,
        description: input.description,
        district: input.district,
        color: '#22c55e', // Color por defecto configurado en backend
        geometry: input.geometry,
        createdById: 'admin-uuid-001',
      },
    });
    // Criterio ético RF-03.1: la creación queda registrada en auditoría
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-uuid-001',
        action: 'CREATE',
        entity: 'Zone',
        entityId: 'zone-123',
      }),
    );
  });

  it('Debe lanzar error 409 si el nombre de la zona ya existe en la base de datos', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-zone-id', name: 'Zona Duplicada' });

    const input = {
      name: 'Zona Duplicada',
      district: 'Wanchaq',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-71.9700, -13.5200],
            [-71.9500, -13.5200],
            [-71.9500, -13.5400],
            [-71.9700, -13.5400],
            [-71.9700, -13.5200],
          ] as [number, number][],
        ] as [number, number][][],
      },
    };

    await expect(createZone(input, 'admin-uuid-001')).rejects.toEqual({
      status: 409,
      message: 'Ya existe una zona con ese nombre',
    });

    expect(prisma.zone.create).not.toHaveBeenCalled();
  });
});

describe('Pruebas de Servicio de Eliminación Lógica de Zonas (RF-03.5 / HU-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Debe eliminar la zona lógicamente (isActive = false) preservando el historial', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue({ id: 'zone-123', name: 'Zona Cusco Centro' });
    (prisma.zone.update as jest.Mock).mockResolvedValue({ id: 'zone-123', isActive: false });

    const result = await deleteZone('zone-123', 'admin-uuid-001');

    expect(result).toBeDefined();
    expect(result.isActive).toBe(false);
    expect(prisma.zone.findUnique).toHaveBeenCalledWith({ where: { id: 'zone-123' } });
    // Eliminación lógica: solo se marca inactiva, sin borrado físico ni cascada
    expect(prisma.zone.update).toHaveBeenCalledWith({
      where: { id: 'zone-123' },
      data: { isActive: false },
    });
    // Los ciudadanos conservan su asignación (no se desvinculan)
    expect(prisma.user.update).not.toHaveBeenCalled();
    // Criterio ético RF-03.1: la eliminación queda registrada en auditoría
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-uuid-001',
        action: 'DELETE',
        entity: 'Zone',
        entityId: 'zone-123',
      }),
    );
  });

  it('Debe lanzar error 404 si la zona a eliminar no existe', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(deleteZone('non-existent-zone')).rejects.toEqual({
      status: 404,
      message: 'Zona no encontrada',
    });

    expect(prisma.zone.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
