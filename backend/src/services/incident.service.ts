import { prisma } from '../config/prisma'
import type { CreateIncidentInput, UpdateIncidentStatusInput } from '../validators/incident.validator'
import { sendIncidentStatusEmail } from './email.service'

// ─── RF-11: Listar incidencias ────────────────────────────────────────────────

export async function listIncidents(
  userId: string,
  role: string,
  filters?: { status?: string; zoneId?: string },
) {
  const isAdmin = role === 'ADMIN'

  const citizenSelect = {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      dni: true,
      phone: true,
      role: true,
      zone: { select: { id: true, name: true, district: true } },
    },
  }

  if (isAdmin) {
    return prisma.incident.findMany({
      where: {
        ...(filters?.status && { status: filters.status as any }),
        ...(filters?.zoneId && { citizen: { zoneId: filters.zoneId } }),
      },
      include: {
        citizen: citizenSelect,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  // Ciudadano/Operador: ver incidencias de su zona + las de creadores con rol ADMIN u OPERATOR
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { zoneId: true } })
  const zoneQuery = me?.zoneId ? { citizen: { zoneId: me.zoneId } } : null

  return prisma.incident.findMany({
    where: {
      OR: [
        ...(zoneQuery ? [zoneQuery] : []),
        { citizen: { role: { in: ['ADMIN', 'OPERATOR'] } } }
      ],
      ...(filters?.status && { status: filters.status as any }),
    },
    include: {
      citizen: citizenSelect,
    },
    orderBy: { createdAt: 'desc' },
  })
}

// ─── RF-11: Obtener incidencia ────────────────────────────────────────────────

export async function getIncident(id: string, userId: string, role: string) {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      citizen: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          dni: true,
          phone: true,
          role: true,
          zone: { select: { id: true, name: true, district: true } },
        },
      },
    },
  })

  if (!incident) throw { status: 404, message: 'Incidencia no encontrada' }

  // Ciudadanos solo pueden ver sus propias incidencias
  if (role !== 'ADMIN' && incident.citizenId !== userId) {
    throw { status: 403, message: 'No tienes permiso para ver esta incidencia' }
  }

  return incident
}

export async function createIncident(input: CreateIncidentInput, citizenId: string) {
  const citizen = await prisma.user.findUnique({
    where: { id: citizenId },
    select: { zoneId: true, role: true }
  })
  
  if (!citizen) {
    throw { status: 404, message: 'Usuario no encontrado' }
  }

  if (citizen.role !== 'ADMIN' && citizen.role !== 'OPERATOR' && !citizen.zoneId) {
    throw { status: 403, message: 'Debes tener una zona asignada para reportar incidencias' }
  }

  const trackingCode = await generateTrackingCode()

  return prisma.incident.create({
    data: {
      type: input.type,
      description: input.description,
      imageUrl: input.imageUrl ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      address: input.address ?? null,
      citizenId,
      trackingCode,
    },
    select: {
      id: true,
      type: true,
      description: true,
      status: true,
      trackingCode: true,
      lat: true,
      lng: true,
      address: true,
      createdAt: true,
    },
  })
}

import { sendPushToUsers } from './push.service'
import { getSocketIO } from '../socket'

async function notifyCitizenStatusChange(
  citizenId: string,
  citizenEmail: string,
  citizenFirstName: string,
  trackingCode: string,
  newStatus: string,
) {
  const statusLabels: Record<string, string> = {
    OPEN: 'Abierta 🔴',
    IN_REVIEW: 'En revisión 🟡',
    RESOLVED: 'Resuelta 🟢',
    CLOSED: 'Cerrada ⚪',
  }
  const statusLabel = statusLabels[newStatus] || newStatus

  const title = `Estado de Incidencia: ${statusLabel}`
  let body = `Tu reporte #${trackingCode} ha sido actualizado a estado ${statusLabel}.`

  if (newStatus === 'IN_REVIEW') {
    body = `Tu reporte #${trackingCode} está siendo evaluado y atendido por el equipo municipal.`
  } else if (newStatus === 'RESOLVED') {
    body = `¡Atención completada! Tu reporte #${trackingCode} ha sido solucionado por la municipalidad.`
  } else if (newStatus === 'CLOSED') {
    body = `El reporte #${trackingCode} ha sido finalizado y cerrado.`
  }

  // 1. WebPush VAPID en segundo plano
  try {
    await sendPushToUsers([citizenId], {
      title,
      body,
      url: '/dashboard/incidents',
      tag: `incident-${trackingCode}`,
    })
  } catch (err) {
    console.warn('[Push] Error notificando cambio de estado:', err)
  }

  // 2. Transmisión WebSocket en tiempo real
  try {
    const io = getSocketIO()
    if (io) {
      io.to(`user:${citizenId}`).emit('route:delay_alert', {
        routeId: `incident-${trackingCode}`,
        routeName: `Incidencia ${trackingCode}`,
        zoneName: 'Atención Municipal',
        delayMinutes: 0,
        reason: body,
      })
    }
  } catch (err) {
    console.warn('[Socket] Error enviando evento de incidencia:', err)
  }

  // 3. Correo electrónico transaccional
  try {
    await sendIncidentStatusEmail(citizenEmail, citizenFirstName, trackingCode, newStatus as any)
  } catch (err) {
    console.error('Error enviando correo de cambio de estado:', err)
  }
}

// ─── RF-11: Actualizar estado (solo ADMIN / OPERATOR) ──────────────────────────

export async function updateIncidentStatus(
  id: string,
  input: UpdateIncidentStatusInput,
) {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: { citizen: { select: { id: true, email: true, firstName: true } } },
  })
  if (!incident) throw { status: 404, message: 'Incidencia no encontrada' }

  const updated = await prisma.incident.update({
    where: { id },
    data: { status: input.status },
  })

  // Notificar al ciudadano por WebPush + Socket + Email
  await notifyCitizenStatusChange(
    incident.citizenId,
    incident.citizen.email,
    incident.citizen.firstName,
    incident.trackingCode,
    input.status,
  )

  return updated
}

// ─── RF-11: Buscar por código de seguimiento ──────────────────────────────────

export async function getByTrackingCode(code: string, userId: string, role: string) {
  const incident = await prisma.incident.findUnique({
    where: { trackingCode: code },
    include: {
      citizen: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  if (!incident) throw { status: 404, message: 'Código de seguimiento inválido' }

  if (role !== 'ADMIN' && incident.citizenId !== userId) {
    throw { status: 403, message: 'No tienes acceso a esta incidencia' }
  }

  return incident
}

async function generateTrackingCode(): Promise<string> {
  const year = new Date().getFullYear()
  let code = ''
  let exists = true

  while (exists) {
    const randomNum = Math.floor(10000 + Math.random() * 90000)
    code = `INC-${year}-${randomNum}`
    const found = await prisma.incident.findUnique({ where: { trackingCode: code } })
    if (!found) {
      exists = false
    }
  }
  return code
}

// ─── RF-11: Actualizar incidencia (Editar) ───────────────────────────────────

export async function updateIncident(
  id: string,
  data: {
    type?: string
    description?: string
    imageUrl?: string | null
    lat?: number | null
    lng?: number | null
    address?: string | null
    status?: any
  },
  userId: string,
  role: string,
) {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: { citizen: { select: { email: true, firstName: true } } },
  })
  if (!incident) throw { status: 404, message: 'Incidencia no encontrada' }

  // Permisos: ADMIN y OPERATOR pueden editar cualquier incidencia.
  // Ciudadanos solo pueden editar su propia incidencia si está OPEN.
  if (role !== 'ADMIN' && role !== 'OPERATOR') {
    if (incident.citizenId !== userId) {
      throw { status: 403, message: 'No tienes permiso para modificar esta incidencia' }
    }
    if (incident.status !== 'OPEN') {
      throw { status: 400, message: 'No puedes modificar una incidencia que ya está en revisión, resuelta o cerrada' }
    }
  }

  // Si cambia el estado, y es Admin/Operador, notificar por correo
  const oldStatus = incident.status
  const newStatus = (role === 'ADMIN' || role === 'OPERATOR') && data.status !== undefined ? data.status : oldStatus

  const updated = await prisma.incident.update({
    where: { id },
    data: {
      type: data.type !== undefined ? data.type as any : incident.type,
      description: data.description !== undefined ? data.description : incident.description,
      imageUrl: data.imageUrl !== undefined ? data.imageUrl : incident.imageUrl,
      lat: data.lat !== undefined ? data.lat : incident.lat,
      lng: data.lng !== undefined ? data.lng : incident.lng,
      address: data.address !== undefined ? data.address : incident.address,
      status: newStatus,
    },
  })

  if (newStatus !== oldStatus) {
    await notifyCitizenStatusChange(
      incident.citizenId,
      incident.citizen.email,
      incident.citizen.firstName,
      incident.trackingCode,
      newStatus,
    )
  }

  return updated
}

// ─── RF-11: Eliminar incidencia ──────────────────────────────────────────────

export async function deleteIncident(id: string, userId: string, role: string) {
  const incident = await prisma.incident.findUnique({ where: { id } })
  if (!incident) throw { status: 404, message: 'Incidencia no encontrada' }

  // Permisos: ADMIN y OPERATOR pueden eliminar cualquier incidencia.
  // Ciudadanos solo pueden eliminar sus propias incidencias si están OPEN.
  if (role !== 'ADMIN' && role !== 'OPERATOR') {
    if (incident.citizenId !== userId) {
      throw { status: 403, message: 'No tienes permiso para eliminar esta incidencia' }
    }
    if (incident.status !== 'OPEN') {
      throw { status: 400, message: 'No puedes eliminar una incidencia que ya está en revisión, resuelta o cerrada' }
    }
  }

  await prisma.incident.delete({ where: { id } })
  return { success: true }
}
