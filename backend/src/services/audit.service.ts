import { prisma } from '../config/prisma'

/**
 * Registro de auditoría transversal (criterios éticos de RF-03, RF-04 y RF-09):
 * deja constancia inmutable de quién, cuándo y qué se modificó.
 * Nunca lanza: un fallo al auditar no debe romper la operación principal.
 */
export async function logAudit(input: {
  actorId?: string | null
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ASSIGN' | 'DUPLICATE'
  entity: 'Zone' | 'Route' | 'User' | 'Vehicle' | 'WasteType' | 'Incident'
  entityId: string
  summary: string
  details?: Record<string, unknown>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        summary: input.summary,
        details: input.details ? JSON.parse(JSON.stringify(input.details)) : undefined,
      },
    })
  } catch (err) {
    console.error('[Auditoría] No se pudo registrar el evento:', err)
  }
}

export async function listAuditLogs(filters: { entity?: string; entityId?: string; limit?: number }) {
  return prisma.auditLog.findMany({
    where: {
      ...(filters.entity && { entity: filters.entity }),
      ...(filters.entityId && { entityId: filters.entityId }),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(filters.limit ?? 100, 500),
  })
}
