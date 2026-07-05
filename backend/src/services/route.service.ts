import { prisma } from '../config/prisma'
import { sendRouteAssignedEmail } from './email.service'
import { logAudit } from './audit.service'
import type { CreateRouteInput, UpdateRouteInput } from '../validators/route.validator'

// ─── RF-09: Listar rutas ──────────────────────────────────────────────────────

export async function listRoutes(filters?: { zoneId?: string; status?: string }) {
  return prisma.route.findMany({
    where: {
      ...(filters?.zoneId && { zoneId: filters.zoneId }),
      ...(filters?.status && { status: filters.status as any }),
    },
    include: {
      zone: { select: { id: true, name: true, color: true } },
      vehicle: { select: { id: true, plate: true, type: true } },
      operator: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { waypoints: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getCitizenSchedule(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, zoneId: true, district: true },
  })
  if (!user) throw { status: 404, message: 'Usuario no encontrado' }

  let source: 'ASSIGNED_ZONE' | 'POROY_REFERENCE' = 'ASSIGNED_ZONE'
  let zoneId = user.zoneId
  let message: string | undefined

  if (!zoneId) {
    const fallbackZone = await prisma.zone.findFirst({
      where: { district: { equals: user.district ?? 'Poroy', mode: 'insensitive' }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    if (!fallbackZone) {
      return {
        source: 'POROY_REFERENCE' as const,
        zoneId: null,
        routes: [],
        message: 'Tu zona esta en revision por el administrador. Aun no hay una zona activa de referencia para tu distrito.',
      }
    }

    source = 'POROY_REFERENCE'
    zoneId = fallbackZone.id
    message = `Tu zona esta en revision por el administrador. Mostramos como referencia general la zona activa ${fallbackZone.name}.`
  }

  const routes = await prisma.route.findMany({
    where: { zoneId, status: 'ACTIVE' },
    include: {
      zone: { select: { id: true, name: true, color: true } },
      vehicle: { select: { id: true, plate: true, type: true } },
      _count: { select: { waypoints: true } },
    },
    orderBy: [{ startTime: 'asc' }, { name: 'asc' }],
  })

  return { source, zoneId, routes, message }
}

// ─── RF-09: Obtener ruta ──────────────────────────────────────────────────────

export async function getRoute(id: string) {
  const route = await prisma.route.findUnique({
    where: { id },
    include: {
      zone: { select: { id: true, name: true, color: true, district: true } },
      vehicle: { select: { id: true, plate: true, type: true, brand: true } },
      operator: { select: { id: true, firstName: true, lastName: true } },
      waypoints: { orderBy: { order: 'asc' } },
      routeWasteTypes: {
        include: {
          wasteType: { select: { id: true, name: true, category: true, colorCode: true } },
        },
      },
    },
  })
  if (!route) throw { status: 404, message: 'Ruta no encontrada' }
  return route
}

// ─── RF-09: Crear ruta ────────────────────────────────────────────────────────

export async function createRoute(input: CreateRouteInput, adminId: string) {
  const zone = await prisma.zone.findUnique({ where: { id: input.zoneId } })
  if (!zone) throw { status: 404, message: 'Zona no encontrada' }

  if (input.operatorId) {
    const operator = await prisma.user.findUnique({ where: { id: input.operatorId } })
    if (!operator || operator.role !== 'OPERATOR') {
      throw { status: 400, message: 'El operador seleccionado no es válido' }
    }
  }

  if (input.vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } })
    if (!vehicle) throw { status: 404, message: 'Vehículo no encontrado' }
  }

  // Validar conflictos de horario
  if (input.operatorId || input.vehicleId) {
    await validateRouteConflicts(input)
  }

  const { waypoints, wasteTypeIds, ...routeData } = input

  const createdRoute = await prisma.$transaction(async (tx) => {
    const route = await tx.route.create({
      data: { ...routeData, createdById: adminId },
    })

    if (waypoints?.length) {
      await tx.waypoint.createMany({
        data: waypoints.map((wp) => ({ ...wp, routeId: route.id })),
      })
    }

    if (wasteTypeIds?.length) {
      await tx.routeWasteType.createMany({
        data: wasteTypeIds.map((wId) => ({ routeId: route.id, wasteTypeId: wId })),
      })
    }

    return tx.route.findUnique({
      where: { id: route.id },
      include: {
        zone: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plate: true } },
        operator: { select: { id: true, firstName: true, lastName: true, email: true } },
        waypoints: { orderBy: { order: 'asc' } },
        routeWasteTypes: { include: { wasteType: { select: { id: true, name: true, category: true } } } },
      },
    })
  })

  if (createdRoute) {
    await logAudit({
      actorId: adminId,
      action: 'CREATE',
      entity: 'Route',
      entityId: createdRoute.id,
      summary: `Creó la ruta "${createdRoute.name}"`,
      details: { zoneId: createdRoute.zoneId, status: createdRoute.status },
    })
  }

  if (createdRoute && createdRoute.operatorId && createdRoute.operator) {
    sendRouteAssignedEmail(
      createdRoute.operator.email,
      createdRoute.operator.firstName,
      createdRoute.name,
      createdRoute.startTime,
      createdRoute.dayOfWeek
    ).catch((err) => console.error('Error al enviar email de asignación al operador:', err))
  }

  return createdRoute
}

// ─── RF-09: Actualizar ruta ───────────────────────────────────────────────────

export async function updateRoute(id: string, input: UpdateRouteInput, actorId?: string) {
  const route = await prisma.route.findUnique({ where: { id } })
  if (!route) throw { status: 404, message: 'Ruta no encontrada' }

  // Validar conflictos de horario
  if (
    input.operatorId !== undefined ||
    input.vehicleId !== undefined ||
    input.dayOfWeek !== undefined ||
    input.startTime !== undefined ||
    input.estimatedDuration !== undefined
  ) {
    const merged = {
      operatorId: input.operatorId !== undefined ? input.operatorId : route.operatorId,
      vehicleId: input.vehicleId !== undefined ? input.vehicleId : route.vehicleId,
      dayOfWeek: input.dayOfWeek !== undefined ? input.dayOfWeek : route.dayOfWeek,
      startTime: input.startTime !== undefined ? input.startTime : route.startTime,
      estimatedDuration: input.estimatedDuration !== undefined ? input.estimatedDuration : route.estimatedDuration,
    }
    await validateRouteConflicts(merged, id)
  }

  const { waypoints, wasteTypeIds, ...fields } = input

  const updatedRoute = await prisma.$transaction(async (tx) => {
    await tx.route.update({
      where: { id },
      data: {
        ...(fields.name !== undefined && { name: fields.name }),
        ...(fields.status !== undefined && { status: fields.status }),
        ...(fields.zoneId !== undefined && { zoneId: fields.zoneId }),
        ...(fields.vehicleId !== undefined && { vehicleId: fields.vehicleId }),
        ...(fields.operatorId !== undefined && { operatorId: fields.operatorId }),
        ...(fields.dayOfWeek !== undefined && { dayOfWeek: fields.dayOfWeek }),
        ...(fields.startTime !== undefined && { startTime: fields.startTime }),
        ...(fields.estimatedDuration !== undefined && { estimatedDuration: fields.estimatedDuration }),
      },
    })

    if (waypoints !== undefined) {
      await tx.waypoint.deleteMany({ where: { routeId: id } })
      if (waypoints.length) {
        await tx.waypoint.createMany({
          data: waypoints.map((wp) => ({ ...wp, routeId: id })),
        })
      }
    }

    if (wasteTypeIds !== undefined) {
      await tx.routeWasteType.deleteMany({ where: { routeId: id } })
      if (wasteTypeIds.length) {
        await tx.routeWasteType.createMany({
          data: wasteTypeIds.map((wId) => ({ routeId: id, wasteTypeId: wId })),
        })
      }
    }

    return tx.route.findUnique({
      where: { id },
      include: {
        zone: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plate: true } },
        operator: { select: { id: true, firstName: true, lastName: true, email: true } },
        waypoints: { orderBy: { order: 'asc' } },
        routeWasteTypes: { include: { wasteType: { select: { id: true, name: true, category: true } } } },
      },
    })
  })

  if (updatedRoute) {
    await logAudit({
      actorId,
      action: 'UPDATE',
      entity: 'Route',
      entityId: updatedRoute.id,
      summary: `Actualizó la ruta "${updatedRoute.name}"`,
      details: { changes: Object.keys(input) },
    })
  }

  // Si se asignó o actualizó el operador
  if (input.operatorId && updatedRoute && updatedRoute.operator) {
    sendRouteAssignedEmail(
      updatedRoute.operator.email,
      updatedRoute.operator.firstName,
      updatedRoute.name,
      updatedRoute.startTime,
      updatedRoute.dayOfWeek
    ).catch((err) => console.error('Error al enviar email de asignación al operador actualizado:', err))
  }

  return updatedRoute
}

// ─── RF-09: Desactivar ruta ───────────────────────────────────────────────────

export async function deactivateRoute(id: string, actorId?: string) {
  const route = await prisma.route.findUnique({ where: { id } })
  if (!route) throw { status: 404, message: 'Ruta no encontrada' }

  const deactivated = await prisma.route.update({
    where: { id },
    data: { status: 'INACTIVE' },
  })

  await logAudit({
    actorId,
    action: 'DELETE',
    entity: 'Route',
    entityId: id,
    summary: `Desactivó la ruta "${route.name}"`,
    details: { previousStatus: route.status },
  })

  return deactivated
}

// ─── RF-09.1: Duplicar ruta ───────────────────────────────────────────────────

export async function duplicateRoute(routeId: string, actorId: string) {
  const original = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      waypoints: { orderBy: { order: 'asc' } },
      routeWasteTypes: true,
    },
  })
  if (!original) throw { status: 404, message: 'Ruta no encontrada' }

  const copyName = `${original.name} (copia)`

  // La copia nace en DRAFT y sin operador/vehículo asignados para
  // evitar conflictos de horario con la ruta original.
  const duplicated = await prisma.$transaction(async (tx) => {
    const route = await tx.route.create({
      data: {
        name: copyName,
        status: 'DRAFT',
        zoneId: original.zoneId,
        createdById: actorId,
        dayOfWeek: original.dayOfWeek,
        startTime: original.startTime,
        estimatedDuration: original.estimatedDuration,
        ...(original.pathGeometry !== null && { pathGeometry: original.pathGeometry }),
      },
    })

    if (original.waypoints.length) {
      await tx.waypoint.createMany({
        data: original.waypoints.map((wp) => ({
          routeId: route.id,
          order: wp.order,
          name: wp.name,
          description: wp.description,
          lat: wp.lat,
          lng: wp.lng,
          estimatedTime: wp.estimatedTime,
        })),
      })
    }

    if (original.routeWasteTypes.length) {
      await tx.routeWasteType.createMany({
        data: original.routeWasteTypes.map((rwt) => ({
          routeId: route.id,
          wasteTypeId: rwt.wasteTypeId,
        })),
      })
    }

    return tx.route.findUnique({
      where: { id: route.id },
      include: {
        zone: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plate: true } },
        operator: { select: { id: true, firstName: true, lastName: true, email: true } },
        waypoints: { orderBy: { order: 'asc' } },
        routeWasteTypes: { include: { wasteType: { select: { id: true, name: true, category: true } } } },
      },
    })
  })

  if (duplicated) {
    await logAudit({
      actorId,
      action: 'DUPLICATE',
      entity: 'Route',
      entityId: duplicated.id,
      summary: `Duplicó la ruta "${original.name}" como "${copyName}"`,
      details: { sourceRouteId: original.id },
    })
  }

  return duplicated
}

// ─── Operadores disponibles (para dropdown en formulario de ruta) ─────────────

export async function listOperators() {
  return prisma.user.findMany({
    where: { role: 'OPERATOR', isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { firstName: 'asc' },
  })
}

// ─── Funciones Auxiliares de Validación de Conflictos ─────────────────────────

function parseTimeToMinutes(timeStr: string | null): number {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

async function validateRouteConflicts(
  input: {
    operatorId?: string | null
    vehicleId?: string | null
    dayOfWeek?: number[]
    startTime?: string | null
    estimatedDuration?: number | null
  },
  excludeRouteId?: string
) {
  const { operatorId, vehicleId, dayOfWeek, startTime, estimatedDuration } = input
  if (!dayOfWeek || !startTime || !estimatedDuration) return
  if (!operatorId && !vehicleId) return

  const newStart = parseTimeToMinutes(startTime)
  const newEnd = newStart + estimatedDuration

  const existingRoutes = await prisma.route.findMany({
    where: {
      id: excludeRouteId ? { not: excludeRouteId } : undefined,
      status: 'ACTIVE',
      OR: [
        ...(operatorId ? [{ operatorId }] : []),
        ...(vehicleId ? [{ vehicleId }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      operatorId: true,
      vehicleId: true,
      dayOfWeek: true,
      startTime: true,
      estimatedDuration: true,
    },
  })

  for (const r of existingRoutes) {
    const commonDays = r.dayOfWeek.filter((d) => dayOfWeek.includes(d))
    if (commonDays.length > 0) {
      const start = parseTimeToMinutes(r.startTime)
      const end = start + (r.estimatedDuration ?? 0)

      if (newStart < end && newEnd > start) {
        const conflictEntity = r.operatorId === operatorId ? 'operador' : 'vehículo'
        throw {
          status: 400,
          message: `Conflicto de horario: El ${conflictEntity} ya está asignado a la ruta "${r.name}" en el horario ${r.startTime} (${r.estimatedDuration} min) para los mismos días.`,
        }
      }
    }
  }
}
