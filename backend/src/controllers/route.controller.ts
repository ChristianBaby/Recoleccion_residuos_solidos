import { Request, Response, NextFunction } from 'express'
import * as routeService from '../services/route.service'
import { ok, created } from '../utils/response'

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const zoneId = req.query['zoneId'] as string | undefined
    const status = req.query['status'] as string | undefined
    const routes = await routeService.listRoutes({ zoneId, status })
    ok(res, routes)
  } catch (err) {
    next(err)
  }
}

export async function mySchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const schedule = await routeService.getCitizenSchedule(req.user!.id)
    ok(res, schedule)
  } catch (err) {
    next(err)
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routeService.getRoute(req.params['id'] as string)
    ok(res, route)
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routeService.createRoute(req.body, req.user!.id)
    created(res, route, 'Ruta creada exitosamente')
  } catch (err) {
    next(err)
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routeService.updateRoute(req.params['id'] as string, req.body, req.user!.id)
    ok(res, route, 'Ruta actualizada exitosamente')
  } catch (err) {
    next(err)
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routeService.deactivateRoute(req.params['id'] as string, req.user!.id)
    ok(res, route, 'Ruta desactivada')
  } catch (err) {
    next(err)
  }
}

export async function duplicate(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routeService.duplicateRoute(req.params['id'] as string, req.user!.id)
    ok(res, route, 'Ruta duplicada exitosamente')
  } catch (err) {
    next(err)
  }
}

export async function operators(req: Request, res: Response, next: NextFunction) {
  try {
    const list = await routeService.listOperators()
    ok(res, list)
  } catch (err) {
    next(err)
  }
}

