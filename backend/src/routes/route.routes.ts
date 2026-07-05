import { Router } from 'express'
import { validate } from '../middleware/validate'
import { requireAuth, requireRole } from '../middleware/auth'
import * as ctrl from '../controllers/route.controller'
import { createRouteSchema, updateRouteSchema } from '../validators/route.validator'

const router = Router()

router.use(requireAuth)

// RF-09: Cualquier usuario autenticado puede ver rutas
router.get('/', ctrl.list)
router.get('/my-schedule', requireRole('CITIZEN'), ctrl.mySchedule)
router.get('/operators', requireRole('ADMIN'), ctrl.operators)
router.get('/:id', ctrl.getById)

// RF-09: Solo ADMIN puede crear/modificar rutas
router.post('/', requireRole('ADMIN'), validate(createRouteSchema), ctrl.create)
router.post('/:id/duplicate', requireRole('ADMIN'), ctrl.duplicate)
router.put('/:id', requireRole('ADMIN'), validate(updateRouteSchema), ctrl.update)
router.patch('/:id/deactivate', requireRole('ADMIN'), ctrl.deactivate)

export default router
