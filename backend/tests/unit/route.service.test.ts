import { listRoutes, getRoute, createRoute, updateRoute, duplicateRoute, getCitizenSchedule } from '../../src/services/route.service';
import { prisma } from '../../src/config/prisma';

// Mock de Prisma Client
jest.mock('../../src/config/prisma', () => ({
  prisma: {
    route: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    zone: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    vehicle: {
      findUnique: jest.fn(),
    },
    waypoint: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    routeWasteType: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
  },
}));

describe('Pruebas de Servicio de Rutas Planificadas - CRUD y Conflictos (HU-07 / RF-09)', () => {
  const mockRoutes = [
    {
      id: 'route-uuid-001',
      name: 'Ruta Cusco Historico A',
      status: 'PLANNED',
      zoneId: 'zone-123',
      dayOfWeek: [1],
      startTime: '08:00',
      estimatedDuration: 120,
      endTime: '12:00',
      zone: { id: 'zone-123', name: 'Zona Centro', color: '#ff5733' },
      vehicle: { id: 'veh-01', plate: 'X1Y-234', type: 'COMPACTOR' },
      operator: { id: 'op-01', firstName: 'Mario', lastName: 'Vargas' },
      _count: { waypoints: 4 },
    },
    {
      id: 'route-uuid-002',
      name: 'Ruta Cusco Historico B',
      status: 'ACTIVE',
      zoneId: 'zone-123',
      dayOfWeek: [3],
      startTime: '14:00',
      estimatedDuration: 60,
      endTime: '18:00',
      zone: { id: 'zone-123', name: 'Zona Centro', color: '#ff5733' },
      vehicle: { id: 'veh-01', plate: 'X1Y-234', type: 'COMPACTOR' },
      operator: { id: 'op-01', firstName: 'Mario', lastName: 'Vargas' },
      _count: { waypoints: 3 },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Debe listar todas las rutas planificadas filtrando opcionalmente por zoneId', async () => {
    (prisma.route.findMany as jest.Mock).mockResolvedValue(mockRoutes);

    const result = await listRoutes({ zoneId: 'zone-123' });

    expect(result).toBeDefined();
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('route-uuid-001');
    expect(prisma.route.findMany).toHaveBeenCalledWith({
      where: {
        zoneId: 'zone-123',
      },
      include: expect.any(Object),
      orderBy: { createdAt: 'desc' },
    });
  });

  it('Debe obtener una ruta especifica con sus paradas (waypoints) ordenadas y detalles asociados', async () => {
    const mockRouteDetail = {
      ...mockRoutes[0],
      waypoints: [
        { id: 'wp-1', lat: -13.53, lng: -71.96, order: 1, address: 'Parada Plaza de Armas' },
        { id: 'wp-2', lat: -13.54, lng: -71.97, order: 2, address: 'Parada Av. El Sol' },
      ],
      routeWasteTypes: [],
    };
    (prisma.route.findUnique as jest.Mock).mockResolvedValue(mockRouteDetail);

    const result = await getRoute('route-uuid-001');

    expect(result).toBeDefined();
    expect(result.id).toBe('route-uuid-001');
    expect(result.waypoints.length).toBe(2);
    expect(result.waypoints[0].order).toBe(1);
  });

  it('Debe lanzar error 404 si la ruta a obtener no existe', async () => {
    (prisma.route.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(getRoute('route-invalida'))
      .rejects.toEqual({ status: 404, message: 'Ruta no encontrada' });
  });

  it('Debe crear una ruta exitosamente si no hay conflictos de horarios', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue({ id: 'zone-123' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'op-01', role: 'OPERATOR' });
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: 'veh-01' });
    
    // Simular que no hay rutas activas con conflicto
    (prisma.route.findMany as jest.Mock).mockResolvedValue([]);
    
    const mockCreatedRoute = {
      id: 'new-route-id',
      name: 'Ruta Cusco Centro Nueva',
      zoneId: 'zone-123',
      operatorId: 'op-01',
      vehicleId: 'veh-01',
      dayOfWeek: [1],
      startTime: '08:00',
      estimatedDuration: 120,
    };
    (prisma.route.create as jest.Mock).mockResolvedValue(mockCreatedRoute);
    (prisma.route.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreatedRoute,
      zone: { id: 'zone-123', name: 'Zona Cusco Centro' },
      vehicle: { id: 'veh-01', plate: 'X1Y-234' },
      operator: { id: 'op-01', firstName: 'Mario', lastName: 'Vargas', email: 'mario@test.com' },
      waypoints: [],
      routeWasteTypes: [],
    });

    const result = await createRoute({
      name: 'Ruta Cusco Centro Nueva',
      zoneId: 'zone-123',
      operatorId: 'op-01',
      vehicleId: 'veh-01',
      dayOfWeek: [1],
      startTime: '08:00',
      estimatedDuration: 120,
      waypoints: [],
      wasteTypeIds: [],
    }, 'admin-uuid');

    expect(result).toBeDefined();
    expect(result?.id).toBe('new-route-id');
    expect(prisma.route.create).toHaveBeenCalled();
  });

  it('Debe lanzar error 400 si se detecta un conflicto de horario para el operador (RF-09)', async () => {
    (prisma.zone.findUnique as jest.Mock).mockResolvedValue({ id: 'zone-123' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'op-01', role: 'OPERATOR' });
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: 'veh-01' });

    // Simular una ruta activa del mismo operador que se solapa (Lunes/1 de 8:00 a 10:00)
    const existingConflictRoute = {
      id: 'existing-route',
      name: 'Ruta Matutina Conflicto',
      status: 'ACTIVE',
      operatorId: 'op-01',
      vehicleId: 'veh-02',
      dayOfWeek: [1],
      startTime: '09:00',
      estimatedDuration: 60,
    };
    (prisma.route.findMany as jest.Mock).mockResolvedValue([existingConflictRoute]);

    await expect(createRoute({
      name: 'Nueva Ruta Cruce',
      zoneId: 'zone-123',
      operatorId: 'op-01',
      vehicleId: 'veh-01',
      dayOfWeek: [1], // Lunes
      startTime: '08:30', // Se cruza con 09:00 a 10:00 ya que dura 60 min y termina a las 09:30
      estimatedDuration: 60,
      waypoints: [],
      wasteTypeIds: [],
    }, 'admin-uuid')).rejects.toEqual({
      status: 400,
      message: 'Conflicto de horario: El operador ya está asignado a la ruta "Ruta Matutina Conflicto" en el horario 09:00 (60 min) para los mismos días.',
    });

    expect(prisma.route.create).not.toHaveBeenCalled();
  });

  it('RF-10 retorna horarios activos de la zona asignada del ciudadano sin exponer datos personales', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'citizen-1',
      role: 'CITIZEN',
      zoneId: 'zone-123',
      district: 'Poroy',
    });
    (prisma.route.findMany as jest.Mock).mockResolvedValue([mockRoutes[1]]);

    const result = await getCitizenSchedule('citizen-1');

    expect(result.source).toBe('ASSIGNED_ZONE');
    expect(result.routes).toHaveLength(1);
    expect(prisma.route.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { zoneId: 'zone-123', status: 'ACTIVE' },
    }));
  });

  it('RF-09.1 Debe duplicar una ruta con sus waypoints y tipos de residuos, en estado DRAFT y sin operador ni vehiculo', async () => {
    const originalRoute = {
      id: 'route-original',
      name: 'Ruta Poroy Norte',
      status: 'ACTIVE',
      zoneId: 'zone-123',
      operatorId: 'op-01',
      vehicleId: 'veh-01',
      createdById: 'admin-original',
      dayOfWeek: [1, 3],
      startTime: '08:00',
      estimatedDuration: 120,
      pathGeometry: null,
      waypoints: [
        { id: 'wp-1', routeId: 'route-original', order: 1, name: 'Plaza', description: null, lat: -13.53, lng: -71.96, estimatedTime: '08:15' },
        { id: 'wp-2', routeId: 'route-original', order: 2, name: 'Mercado', description: 'Puerta principal', lat: -13.54, lng: -71.97, estimatedTime: '08:40' },
      ],
      routeWasteTypes: [
        { routeId: 'route-original', wasteTypeId: 'wt-1' },
        { routeId: 'route-original', wasteTypeId: 'wt-2' },
      ],
    };

    const duplicatedRoute = {
      id: 'route-copia',
      name: 'Ruta Poroy Norte (copia)',
      status: 'DRAFT',
      zoneId: 'zone-123',
      operatorId: null,
      vehicleId: null,
      dayOfWeek: [1, 3],
      startTime: '08:00',
      estimatedDuration: 120,
      zone: { id: 'zone-123', name: 'Zona Centro' },
      vehicle: null,
      operator: null,
      waypoints: originalRoute.waypoints.map((wp, i) => ({ ...wp, id: `wp-copia-${i}`, routeId: 'route-copia' })),
      routeWasteTypes: [
        { routeId: 'route-copia', wasteTypeId: 'wt-1', wasteType: { id: 'wt-1', name: 'Organico', category: 'ORGANIC' } },
        { routeId: 'route-copia', wasteTypeId: 'wt-2', wasteType: { id: 'wt-2', name: 'Reciclable', category: 'RECYCLABLE' } },
      ],
    };

    (prisma.route.findUnique as jest.Mock)
      .mockResolvedValueOnce(originalRoute) // lectura de la ruta original
      .mockResolvedValueOnce(duplicatedRoute); // lectura final dentro de la transaccion
    (prisma.route.create as jest.Mock).mockResolvedValue({ id: 'route-copia', name: 'Ruta Poroy Norte (copia)' });

    const result = await duplicateRoute('route-original', 'admin-uuid');

    // La copia se crea en DRAFT, sin operador ni vehiculo, con nombre "(copia)"
    expect(prisma.route.create).toHaveBeenCalledWith({
      data: {
        name: 'Ruta Poroy Norte (copia)',
        status: 'DRAFT',
        zoneId: 'zone-123',
        createdById: 'admin-uuid',
        dayOfWeek: [1, 3],
        startTime: '08:00',
        estimatedDuration: 120,
      },
    });

    // Copia los waypoints preservando orden y tiempos
    expect(prisma.waypoint.createMany).toHaveBeenCalledWith({
      data: [
        { routeId: 'route-copia', order: 1, name: 'Plaza', description: null, lat: -13.53, lng: -71.96, estimatedTime: '08:15' },
        { routeId: 'route-copia', order: 2, name: 'Mercado', description: 'Puerta principal', lat: -13.54, lng: -71.97, estimatedTime: '08:40' },
      ],
    });

    // Copia los tipos de residuos asociados
    expect(prisma.routeWasteType.createMany).toHaveBeenCalledWith({
      data: [
        { routeId: 'route-copia', wasteTypeId: 'wt-1' },
        { routeId: 'route-copia', wasteTypeId: 'wt-2' },
      ],
    });

    // Registra auditoria de la duplicacion
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'admin-uuid',
          action: 'DUPLICATE',
          entity: 'Route',
          entityId: 'route-copia',
        }),
      }),
    );

    expect(result).toBeDefined();
    expect(result?.id).toBe('route-copia');
    expect(result?.status).toBe('DRAFT');
    expect(result?.operatorId).toBeNull();
    expect(result?.vehicleId).toBeNull();
    expect(result?.waypoints.length).toBe(2);
  });

  it('RF-09.1 Debe lanzar error 404 al duplicar una ruta inexistente', async () => {
    (prisma.route.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(duplicateRoute('route-fantasma', 'admin-uuid'))
      .rejects.toEqual({ status: 404, message: 'Ruta no encontrada' });

    expect(prisma.route.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('RF-10 usa una zona activa de Poroy como referencia cuando el ciudadano aun no tiene zona', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'citizen-2',
      role: 'CITIZEN',
      zoneId: null,
      district: 'Poroy',
    });
    (prisma.zone.findFirst as jest.Mock).mockResolvedValue({ id: 'zone-ref', name: 'Poroy Centro' });
    (prisma.route.findMany as jest.Mock).mockResolvedValue([mockRoutes[1]]);

    const result = await getCitizenSchedule('citizen-2');

    expect(result.source).toBe('POROY_REFERENCE');
    expect(result.message).toContain('revision');
    expect(prisma.route.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { zoneId: 'zone-ref', status: 'ACTIVE' },
    }));
  });
});
