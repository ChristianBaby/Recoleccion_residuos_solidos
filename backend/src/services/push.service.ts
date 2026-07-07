import webpush from 'web-push'
import { prisma } from '../config/prisma'

// RF-17: Notificaciones Web Push para la PWA (funcionan con la app cerrada).
// Requiere claves VAPID en el entorno; sin ellas el servicio queda desactivado
// de forma segura (los eventos Socket.IO y correos siguen funcionando).

let vapidConfigured = false

export function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    console.warn('[Push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas: Web Push desactivado')
    vapidConfigured = false
    return false
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:soporte@recoleccion-residuos.pe',
    publicKey,
    privateKey,
  )
  vapidConfigured = true
  return true
}

export function isPushEnabled() {
  return vapidConfigured
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? null
}

export interface WebPushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// Opt-in del usuario: guarda (o renueva) la suscripción del navegador
export async function saveSubscription(userId: string, sub: WebPushSubscriptionInput) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userId,
    },
    update: {
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userId,
    },
  })
}

export async function removeSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } })
}

export interface PushPayload {
  title: string
  body: string
  url?: string
}

// Envía el push a todas las suscripciones de los usuarios indicados.
// Las suscripciones muertas (404/410 del push service) se eliminan de la BD.
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (!vapidConfigured || userIds.length === 0) return { sent: 0, removed: 0 }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  })
  if (subscriptions.length === 0) return { sent: 0, removed: 0 }

  const body = JSON.stringify(payload)
  let sent = 0
  const deadEndpoints: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        )
        sent++
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          deadEndpoints.push(sub.endpoint)
        } else {
          console.error('[Push] Error enviando notificación:', statusCode ?? err)
        }
      }
    }),
  )

  if (deadEndpoints.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { endpoint: { in: deadEndpoints } } })
      .catch(() => { /* la limpieza no debe romper el envío */ })
  }

  return { sent, removed: deadEndpoints.length }
}
