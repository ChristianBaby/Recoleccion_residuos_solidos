import { z } from 'zod'

const waypointSchema = z.object({
  order: z.number().int().min(1),
  name: z.string().max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  estimatedTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:mm').optional(),
})

export const createRouteSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(100).trim(),
  zoneId: z.string().min(1, 'La zona es requerida'),
  vehicleId: z.string().optional(),
  operatorId: z.string().optional(),
  dayOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Seleccione al menos un día'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:mm').optional(),
  estimatedDuration: z.number().int().positive('Debe ser positivo').optional(),
  wasteTypeIds: z.array(z.string()).optional(),
  waypoints: z.array(waypointSchema).optional(),
})

export const updateRouteSchema = createRouteSchema.partial().extend({
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']).optional(),
})

// RF-18: cantidades recolectadas por categoría al cierre de ruta
export const registerCollectionSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(['ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE', 'HAZARDOUS']),
        quantityKg: z.number().min(0, 'La cantidad no puede ser negativa').max(100000),
      }),
    )
    .min(1, 'Registre al menos una categoría'),
})

export type CreateRouteInput = z.infer<typeof createRouteSchema>
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>
export type RegisterCollectionInput = z.infer<typeof registerCollectionSchema>
