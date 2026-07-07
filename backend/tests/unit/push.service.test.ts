import webpush from 'web-push'
import {
  configureWebPush,
  saveSubscription,
  removeSubscription,
  sendPushToUsers,
} from '../../src/services/push.service'
import { prisma } from '../../src/config/prisma'

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}))

jest.mock('../../src/config/prisma', () => ({
  prisma: {
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:test@test.pe',
}

describe('RF-17: Servicio de notificaciones Web Push', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, ...VAPID_ENV }
    configureWebPush()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('queda desactivado de forma segura si faltan las claves VAPID', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    expect(configureWebPush()).toBe(false)

    const result = await sendPushToUsers(['user-1'], { title: 't', body: 'b' })
    expect(result).toEqual({ sent: 0, removed: 0 })
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()
  })

  it('se configura con claves VAPID válidas', () => {
    expect(configureWebPush()).toBe(true)
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:test@test.pe',
      'test-public-key',
      'test-private-key',
    )
  })

  it('guarda la suscripción con upsert por endpoint (renovaciones no duplican)', async () => {
    ;(prisma.pushSubscription.upsert as jest.Mock).mockResolvedValue({ id: 'sub-1' })

    await saveSubscription('user-1', {
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: 'p', auth: 'a' },
    })

    const call = (prisma.pushSubscription.upsert as jest.Mock).mock.calls[0][0]
    expect(call.where).toEqual({ endpoint: 'https://push.example.com/abc' })
    expect(call.create.userId).toBe('user-1')
    expect(call.update.p256dh).toBe('p')
  })

  it('elimina solo la suscripción del propio usuario al desuscribirse', async () => {
    await removeSubscription('user-1', 'https://push.example.com/abc')
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example.com/abc', userId: 'user-1' },
    })
  })

  it('envía el payload a todas las suscripciones de los usuarios indicados', async () => {
    ;(prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
      { endpoint: 'e1', p256dh: 'p1', auth: 'a1', userId: 'user-1' },
      { endpoint: 'e2', p256dh: 'p2', auth: 'a2', userId: 'user-1' },
    ])
    ;(webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 })

    const result = await sendPushToUsers(['user-1'], {
      title: '🚛 El camión está cerca',
      body: 'Vehículo ABC-123 a 300 m de tu domicilio.',
      url: '/dashboard/tracking',
    })

    expect(result.sent).toBe(2)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    const payload = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1])
    expect(payload.title).toContain('camión')
    // Privacidad: el payload no incluye datos personales del operador
    expect(JSON.stringify(payload)).not.toMatch(/operator|nombre|dni|email/i)
  })

  it('depura las suscripciones muertas cuando el push service responde 410', async () => {
    ;(prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
      { endpoint: 'vivo', p256dh: 'p', auth: 'a', userId: 'user-1' },
      { endpoint: 'muerto', p256dh: 'p', auth: 'a', userId: 'user-2' },
    ])
    ;(webpush.sendNotification as jest.Mock).mockImplementation((sub) =>
      sub.endpoint === 'muerto'
        ? Promise.reject({ statusCode: 410 })
        : Promise.resolve({ statusCode: 201 }),
    )
    ;(prisma.pushSubscription.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

    const result = await sendPushToUsers(['user-1', 'user-2'], { title: 't', body: 'b' })

    expect(result.sent).toBe(1)
    expect(result.removed).toBe(1)
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: { in: ['muerto'] } },
    })
  })

  it('no falla ante errores transitorios del push service (500)', async () => {
    ;(prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
      { endpoint: 'e1', p256dh: 'p', auth: 'a', userId: 'user-1' },
    ])
    ;(webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 500 })

    const result = await sendPushToUsers(['user-1'], { title: 't', body: 'b' })

    expect(result.sent).toBe(0)
    expect(result.removed).toBe(0)
    // el error 500 no borra la suscripción (solo 404/410)
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('no consulta la BD si la lista de usuarios está vacía', async () => {
    const result = await sendPushToUsers([], { title: 't', body: 'b' })
    expect(result).toEqual({ sent: 0, removed: 0 })
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()
  })
})
