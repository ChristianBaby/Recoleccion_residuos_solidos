import { Request, Response, NextFunction } from 'express'
import * as pushService from '../services/push.service'
import { ok, created } from '../utils/response'

// RF-17: clave pública VAPID para que el navegador se suscriba
export async function publicKey(_req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, {
      enabled: pushService.isPushEnabled(),
      publicKey: pushService.getVapidPublicKey(),
    })
  } catch (err) {
    next(err)
  }
}

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    await pushService.saveSubscription(req.user!.id, req.body)
    created(res, { ok: true }, 'Suscripción push registrada')
  } catch (err) {
    next(err)
  }
}

export async function unsubscribe(req: Request, res: Response, next: NextFunction) {
  try {
    await pushService.removeSubscription(req.user!.id, req.body.endpoint)
    ok(res, { ok: true }, 'Suscripción push eliminada')
  } catch (err) {
    next(err)
  }
}
