import { api } from './api'

// RF-17: Suscripción Web Push de la PWA.
// El opt-in es explícito: solo se suscribe cuando el usuario pulsa el botón
// de notificaciones y el navegador concede el permiso.

interface PublicKeyResponse {
  success?: boolean
  data?: { enabled: boolean; publicKey: string | null }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  // El SW solo se registra en producción; en desarrollo no hay registration
  const registration = await navigator.serviceWorker.getRegistration()
  return registration ?? null
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(accessToken: string): Promise<boolean> {
  const registration = await getRegistration()
  if (!registration) return false

  const keyRes = await api.get<PublicKeyResponse>('/push/public-key', accessToken)
  const publicKey = keyRes.data?.publicKey
  if (!keyRes.data?.enabled || !publicKey) return false

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  })

  await api.post('/push/subscribe', subscription.toJSON(), accessToken)
  return true
}

export async function unsubscribeFromPush(accessToken: string): Promise<void> {
  const subscription = await getCurrentPushSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await api.post('/push/unsubscribe', { endpoint }, accessToken).catch(() => {
    // si el backend no responde, la suscripción local ya quedó anulada
  })
}
