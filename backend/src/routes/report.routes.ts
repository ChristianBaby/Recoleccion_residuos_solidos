import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth'
import * as ctrl from '../controllers/report.controller'

const router = Router()

router.use(requireAuth)
router.use(requireRole('ADMIN'))

// RF-15: Cumplimiento de rutas
router.get('/route-compliance', ctrl.routeCompliance)

export default router

