import { prisma } from '../config/prisma'
import { pointInPolygon, polygonsOverlap } from '../utils/geoUtils'
import { logAudit } from './audit.service'
import { sendZoneAssignedEmail } from './email.service'
import type { CreateZoneInput, UpdateZoneInput } from '../validators/zone.validator'

type PolygonGeometry = { type: 'Polygon'; coordinates: [number, number][][] }

// ─── RF-03.2: Validación de solapamiento de polígonos ────────────────────────

/**
 * Verifica que la geometría propuesta no se solape con ninguna zona activa.
 * Al editar, `excludeZoneId` excluye la propia zona de la comparación.
 * Lanza 409 con el id de la zona en conflicto si hay solapamiento.
 */
async function ensureNoOverlap(geometry: PolygonGeometry, excludeZoneId?: string) {
  const zones = await prisma.zone.findMany({
    where: {
      isActive: true,
      ...(excludeZoneId && { id: { not: excludeZoneId } }),
    },
    select: { id: true, name: true, geometry: true },
  })

  const newRing = geometry.coordinates[0]

  for (const zone of zones) {
    const geo = zone.geometry as PolygonGeometry
    const ring = geo?.coordinates?.[0]
    if (!ring) continue
    if (polygonsOverlap(newRing, ring)) {
      throw {
        status: 409,
        message: `La zona se solapa con la zona "${zone.name}"`,
        details: { conflictZoneId: zone.id },
      }
    }
  }
}

// ─── RF-03.4: Reasignación automática al editar la geometría ─────────────────

/**
 * Recalcula la asignación de ciudadanos tras un cambio de geometría:
 *  - Los usuarios de la zona que quedan fuera pasan a otra zona activa que
 *    los contenga o a zoneId null (pendiente).
 *  - Los usuarios pendientes (zoneId null con coordenadas) que ahora quedan
 *    dentro se asignan a la zona.
 * Notifica por email cada nueva asignación (best-effort).
 */
async function reassignUsersAfterGeometryChange(zone: {
  id: string
  name: string
  district: string
  isActive: boolean
  geometry: unknown
}) {
  const geo = zone.geometry as PolygonGeometry
  const newRing = geo?.coordinates?.[0]
  if (!newRing) return

  const otherActiveZones = await prisma.zone.findMany({
    where: { isActive: true, id: { not: zone.id } },
    select: { id: true, name: true, district: true, geometry: true },
  })

  const findContainingZone = (lat: number, lng: number) => {
    for (const other of otherActiveZones) {
      const otherGeo = other.geometry as PolygonGeometry
      const ring = otherGeo?.coordinates?.[0]
      if (ring && pointInPolygon(lat, lng, ring)) return other
    }
    return null
  }

  // 1. Usuarios de la zona que quedaron fuera de la nueva geometría
  const zoneUsers = await prisma.user.findMany({
    where: { zoneId: zone.id, homeLat: { not: null }, homeLng: { not: null } },
    select: { id: true, email: true, firstName: true, homeLat: true, homeLng: true },
  })

  for (const user of zoneUsers) {
    if (pointInPolygon(user.homeLat as number, user.homeLng as number, newRing)) continue

    const newZone = findContainingZone(user.homeLat as number, user.homeLng as number)
    await prisma.user.update({
      where: { id: user.id },
      data: { zoneId: newZone?.id ?? null },
    })

    if (newZone) {
      try {
        await sendZoneAssignedEmail(user.email, user.firstName, newZone.name, newZone.district)
      } catch (err) {
        console.error('Error enviando email de reasignación de zona:', err)
      }
    }
  }

  // 2. Usuarios pendientes que ahora quedan dentro de la zona editada
  if (zone.isActive) {
    const pendingUsers = await prisma.user.findMany({
      where: { zoneId: null, homeLat: { not: null }, homeLng: { not: null } },
      select: { id: true, email: true, firstName: true, homeLat: true, homeLng: true },
    })

    for (const user of pendingUsers) {
      if (!pointInPolygon(user.homeLat as number, user.homeLng as number, newRing)) continue

      await prisma.user.update({
        where: { id: user.id },
        data: { zoneId: zone.id },
      })

      try {
        await sendZoneAssignedEmail(user.email, user.firstName, zone.name, zone.district)
      } catch (err) {
        console.error('Error enviando email de asignación de zona:', err)
      }
    }
  }
}

// ─── RF-03: Listar zonas ──────────────────────────────────────────────────────

export async function listZones() {
  return prisma.zone.findMany({
    include: {
      _count: { select: { users: true, routes: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

// ─── RF-03: Obtener zona ──────────────────────────────────────────────────────

export async function getZone(id: string) {
  const zone = await prisma.zone.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true, routes: true } },
      routes: { select: { id: true, name: true, status: true } },
    },
  })
  if (!zone) throw { status: 404, message: 'Zona no encontrada' }
  return zone
}

// ─── RF-03: Crear zona ────────────────────────────────────────────────────────

export async function createZone(input: CreateZoneInput, adminId: string) {
  const exists = await prisma.zone.findUnique({ where: { name: input.name } })
  if (exists) throw { status: 409, message: 'Ya existe una zona con ese nombre' }

  // RF-03.2: la nueva geometría no debe solaparse con zonas activas
  await ensureNoOverlap(input.geometry as PolygonGeometry)

  const zone = await prisma.zone.create({
    data: {
      name: input.name,
      description: input.description,
      district: input.district,
      color: input.color ?? '#22c55e',
      geometry: input.geometry,
      createdById: adminId,
    },
  })

  // Criterio ético RF-03.1: constancia de quién creó la zona
  await logAudit({
    actorId: adminId,
    action: 'CREATE',
    entity: 'Zone',
    entityId: zone.id,
    summary: `Zona "${zone.name}" creada (distrito ${zone.district})`,
  })

  return zone
}

// ─── RF-03: Actualizar zona ───────────────────────────────────────────────────

export async function updateZone(id: string, input: UpdateZoneInput, actorId?: string) {
  const zone = await prisma.zone.findUnique({ where: { id } })
  if (!zone) throw { status: 404, message: 'Zona no encontrada' }

  if (input.name && input.name !== zone.name) {
    const exists = await prisma.zone.findUnique({ where: { name: input.name } })
    if (exists) throw { status: 409, message: 'Ya existe una zona con ese nombre' }
  }

  // RF-03.2: al editar la geometría, validar solapamiento excluyendo la propia zona
  if (input.geometry !== undefined) {
    await ensureNoOverlap(input.geometry as PolygonGeometry, id)
  }

  const updated = await prisma.zone.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.district !== undefined && { district: input.district }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.geometry !== undefined && { geometry: input.geometry }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  })

  // RF-03.4: recalcular asignaciones de ciudadanos si cambió la geometría
  if (input.geometry !== undefined) {
    await reassignUsersAfterGeometryChange(updated)
  }

  // Criterio ético RF-03.1: constancia de quién modificó la zona
  await logAudit({
    actorId,
    action: 'UPDATE',
    entity: 'Zone',
    entityId: id,
    summary: `Zona "${updated.name}" actualizada`,
    details: { camposModificados: Object.keys(input) },
  })

  return updated
}

// ─── RF-04: Detectar zona por coordenadas GPS ─────────────────────────────────

export async function detectZoneByCoords(lat: number, lng: number) {
  const zones = await prisma.zone.findMany({ where: { isActive: true } })

  for (const zone of zones) {
    const geo = zone.geometry as { coordinates: [number, number][][] }
    const ring = geo.coordinates[0]
    if (pointInPolygon(lat, lng, ring)) {
      return zone
    }
  }
  return null
}

// ─── RF-04: Asignar zona al usuario actual ────────────────────────────────────

export async function assignZoneToUser(userId: string, lat: number, lng: number) {
  const zone = await detectZoneByCoords(lat, lng)

  await prisma.user.update({
    where: { id: userId },
    data: { zoneId: zone?.id ?? null, homeLat: lat, homeLng: lng },
  })

  return zone
}

// ─── RF-03: Activar / Desactivar zona ────────────────────────────────────────

export async function toggleZoneStatus(id: string) {
  const zone = await prisma.zone.findUnique({ where: { id } })
  if (!zone) throw { status: 404, message: 'Zona no encontrada' }

  return prisma.zone.update({
    where: { id },
    data: { isActive: !zone.isActive },
  })
}

// ─── RF-03.5: Eliminación lógica de zona ─────────────────────────────────────

/**
 * Eliminación lógica: marca la zona como inactiva (isActive = false) para
 * preservar el historial de rutas, reportes y asignaciones. Los usuarios
 * conservan su zoneId hasta que sean reasignados.
 */
export async function deleteZone(id: string, actorId?: string) {
  const zone = await prisma.zone.findUnique({ where: { id } })
  if (!zone) throw { status: 404, message: 'Zona no encontrada' }

  const deleted = await prisma.zone.update({
    where: { id },
    data: { isActive: false },
  })

  // Criterio ético RF-03.1: constancia de quién eliminó la zona
  await logAudit({
    actorId,
    action: 'DELETE',
    entity: 'Zone',
    entityId: id,
    summary: `Zona "${zone.name}" eliminada lógicamente (isActive = false)`,
  })

  return deleted
}

