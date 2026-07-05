import { prisma } from '../config/prisma'
import { sendZoneAssignedEmail } from './email.service'
import { logAudit } from './audit.service'
import bcrypt from 'bcryptjs'

export async function createStaffUser(input: {
  email: string
  password: string
  firstName: string
  lastName: string
  dni: string
  phone?: string
  role: 'OPERATOR' | 'ADMIN'
}) {
  const emailExists = await prisma.user.findUnique({ where: { email: input.email } })
  if (emailExists) throw { status: 409, message: 'El correo ya está registrado' }

  const dniExists = await prisma.user.findUnique({ where: { dni: input.dni } })
  if (dniExists) throw { status: 409, message: 'El DNI ya está registrado' }

  const hashed = await bcrypt.hash(input.password, 12)

  return prisma.user.create({
    data: {
      email: input.email,
      password: hashed,
      firstName: input.firstName,
      lastName: input.lastName,
      dni: input.dni,
      phone: input.phone ?? null,
      role: input.role,
      isVerified: true,
      isActive: true,
    },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      dni: true, phone: true, role: true, isActive: true, isVerified: true,
      createdAt: true,
    },
  })
}

export async function toggleUserActive(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } })
  if (!user) throw { status: 404, message: 'Usuario no encontrado' }
  return prisma.user.update({
    where: { id: userId },
    data: { isActive: !user.isActive },
    select: { id: true, isActive: true },
  })
}

export async function listUsers(filters?: { role?: string; hasZone?: boolean }) {
  return prisma.user.findMany({
    where: {
      ...(filters?.role && { role: filters.role as any }),
      ...(filters?.hasZone === true  && { zoneId: { not: null } }),
      ...(filters?.hasZone === false && { zoneId: null }),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      dni: true,
      phone: true,
      address: true,
      district: true,
      role: true,
      isActive: true,
      isVerified: true,
      zoneId: true,
      zone: { select: { id: true, name: true, district: true, color: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function assignZone(userId: string, zoneId: string | null, actorId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  })
  if (!user) throw { status: 404, message: 'Usuario no encontrado' }

  let zoneName = ''
  let zoneDistrict = ''

  if (zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: zoneId } })
    if (!zone) throw { status: 404, message: 'Zona no encontrada' }
    zoneName = zone.name
    zoneDistrict = zone.district
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { zoneId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      zoneId: true,
      zone: { select: { id: true, name: true, district: true, color: true } },
    },
  })

  if (zoneId && zoneName) {
    try {
      await sendZoneAssignedEmail(user.email, user.firstName, zoneName, zoneDistrict)
    } catch (err) {
      console.error('Error enviando email de asignación de zona:', err)
    }
  }

  // Criterio ético RF-04.3: constancia de la asignación manual de zona
  await logAudit({
    actorId,
    action: 'ASSIGN',
    entity: 'User',
    entityId: userId,
    summary: zoneId
      ? `Zona "${zoneName}" asignada manualmente al usuario`
      : 'Zona removida manualmente del usuario (queda pendiente)',
    details: { zoneId },
  })

  return updated
}
