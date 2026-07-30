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

export async function triggerTestPush(_req: Request, res: Response, next: NextFunction) {
  try {
    const { prisma } = await import('../config/prisma')
    const { getSocketIO } = await import('../socket')

    const users = await prisma.user.findMany({ select: { id: true } })
    const userIds = users.map((u) => u.id)

    // 1. Enviar WebPush VAPID en segundo plano (para dispositivos suscritos con app cerrada)
    const pushResult = await pushService.sendPushToUsers(userIds, {
      title: '🧪 Notificación de Prueba — EcoRutas Poroy',
      body: '¡Esta es una notificación de prueba masiva enviada a todos los usuarios y roles!',
      url: '/dashboard',
      tag: 'all-roles-test',
    })

    // 2. Emitir por Socket.IO en tiempo real a todos los clientes web/móviles abiertos
    const io = getSocketIO()
    let socketEmitted = false

    if (io) {
      io.emit('route:delay_alert', {
        routeId: 'demo-test-route',
        routeName: 'Ruta de Recolección de Prueba',
        zoneName: 'Poroy - Todos los Sectores',
        delayMinutes: 15,
        reason: '🧪 Notificación de prueba masiva transmitida en vivo a todos los roles — EcoRutas Poroy',
      })
      socketEmitted = true
    }

    ok(res, {
      triggered: true,
      totalUsers: userIds.length,
      pushResult,
      socketEmitted,
      timestamp: new Date().toISOString(),
    }, 'Notificación de prueba masiva transmitida exitosamente a todos los roles')
  } catch (err) {
    next(err)
  }
}
