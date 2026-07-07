import { Router } from 'express'
import authRoutes from './auth.routes'
import zoneRoutes from './zone.routes'
import vehicleRoutes from './vehicle.routes'
import routeRoutes from './route.routes'
import wasteRoutes from './waste.routes'
import incidentRoutes from './incident.routes'
import reportRoutes from './report.routes'
import userRoutes from './user.routes'
import pageVisitRoutes from './pageVisit.routes'
import pushRoutes from './push.routes'

const router = Router()

router.use('/auth', authRoutes)
router.use('/zones', zoneRoutes)              // RF-03, RF-04
router.use('/vehicles', vehicleRoutes)        // prerequisito RF-09
router.use('/routes', routeRoutes)            // RF-07, RF-09
router.use('/waste-types', wasteRoutes)       // RF-05, RF-06
router.use('/incidents', incidentRoutes)      // RF-11
router.use('/reports', reportRoutes)          // RF-14, RF-15, RF-16
router.use('/users', userRoutes)              // Gestión de usuarios
router.use('/page-visits', pageVisitRoutes)   // RF-16: consultas educativas
router.use('/push', pushRoutes)               // RF-17: notificaciones push PWA

export default router
