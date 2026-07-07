import { prisma } from '../config/prisma'
import { WasteCategory } from '@prisma/client'

export interface CollectionItemInput {
  category: WasteCategory
  quantityKg: number
}

// RF-18: el operador declara las cantidades recolectadas al cerrar su ruta.
// Upsert por (ejecución, categoría): reintentos o correcciones no duplican filas.
export async function registerCollectionRecords(
  executionId: string,
  items: CollectionItemInput[],
  actor: { id: string; role: string },
) {
  const execution = await prisma.routeExecution.findUnique({
    where: { id: executionId },
    select: { id: true, operatorId: true },
  })
  if (!execution) throw { status: 404, message: 'Ejecución de ruta no encontrada' }

  // Solo el operador dueño de la ejecución (o un admin) puede declarar cantidades
  if (actor.role !== 'ADMIN' && execution.operatorId !== actor.id) {
    throw { status: 403, message: 'No puedes registrar cantidades de una ruta ajena' }
  }

  const records = await prisma.$transaction(
    items.map((item) =>
      prisma.collectionRecord.upsert({
        where: {
          routeExecutionId_category: {
            routeExecutionId: executionId,
            category: item.category,
          },
        },
        create: {
          routeExecutionId: executionId,
          category: item.category,
          quantityKg: item.quantityKg,
          recordedById: actor.id,
        },
        update: {
          quantityKg: item.quantityKg,
          recordedById: actor.id,
        },
      }),
    ),
  )

  return records
}
