import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import * as ctrl from '../controllers/push.controller'

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

const router = Router()

// RF-17: suscripción Web Push (opt-in explícito del usuario autenticado)
router.use(requireAuth)
router.get('/public-key', ctrl.publicKey)
router.post('/subscribe', validate(subscribeSchema), ctrl.subscribe)
router.post('/unsubscribe', validate(unsubscribeSchema), ctrl.unsubscribe)

export default router
