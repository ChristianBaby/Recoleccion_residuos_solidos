import { Request, Response, NextFunction } from 'express'
import * as zoneService from '../services/zone.service'
import { ok, created, badRequest } from '../utils/response'

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const zones = await zoneService.listZones()
    ok(res, zones)
  } catch (err) {
    next(err)
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const zone = await zoneService.getZone(req.params['id'] as string)
    ok(res, zone)
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const zone = await zoneService.createZone(req.body, req.user!.id)
    created(res, zone, 'Zona creada exitosamente')
  } catch (err) {
    next(err)
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const zone = await zoneService.updateZone(req.params['id'] as string, req.body, req.user!.id)
    ok(res, zone, 'Zona actualizada exitosamente')
  } catch (err) {
    next(err)
  }
}

export async function toggleStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const zone = await zoneService.toggleZoneStatus(req.params['id'] as string)
    ok(res, zone, zone.isActive ? 'Zona activada' : 'Zona desactivada')
  } catch (err) {
    next(err)
  }
}

// ─── RF-04 ────────────────────────────────────────────────────────────────────

export async function detect(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lng } = req.body as { lat: number; lng: number }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return badRequest(res, 'Se requieren lat y lng numéricos')
    }
    const zone = await zoneService.detectZoneByCoords(lat, lng)
    ok(res, zone, zone ? `Zona detectada: ${zone.name}` : 'Tu ubicación no pertenece a ninguna zona registrada')
  } catch (err) {
    next(err)
  }
}

export async function assignMe(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lng } = req.body as { lat: number; lng: number }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return badRequest(res, 'Se requieren lat y lng numéricos')
    }
    const zone = await zoneService.assignZoneToUser(req.user!.id, lat, lng)
    ok(res, zone, zone ? `Zona asignada: ${zone.name}` : 'No se encontró zona para tu ubicación. Permaneces sin zona asignada.')
  } catch (err) {
    next(err)
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await zoneService.deleteZone(req.params['id'] as string, req.user!.id)
    ok(res, null, 'Zona eliminada exitosamente')
  } catch (err) {
    next(err)
  }
}

