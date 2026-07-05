import bcrypt from 'bcryptjs'
import { prisma } from '../config/prisma'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt'
import { generateSecureToken, addHours, addMinutes } from '../utils/crypto'
import { sendVerificationEmail, sendPasswordResetEmail, sendPendingZoneAlertEmail } from './email.service'
import type { RegisterInput, LoginInput } from '../validators/auth.validator'
import { detectZoneByCoords } from './zone.service'

const SALT_ROUNDS = 12
const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MINUTES = 15
const VERIFICATION_EXPIRY_HOURS = 24
const RESET_EXPIRY_HOURS = 1

// ─── Perfil propio ───────────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      dni: true, phone: true, address: true, district: true,
      role: true, isActive: true, isVerified: true, zoneId: true,
      alertRadius: true,
      zone: { select: { id: true, name: true, district: true, color: true } },
    },
  })
  if (!user) throw { status: 404, message: 'Usuario no encontrado' }
  return user
}

export async function updateProfile(
  userId: string,
  data: { firstName: string; lastName: string; phone?: string; address: string; alertRadius?: number },
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || null,
      address: data.address,
      ...(data.alertRadius !== undefined && {
        alertRadius: Math.min(Math.max(data.alertRadius, 100), 2000),
      }),
    },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      phone: true, address: true, district: true, role: true,
      zoneId: true, alertRadius: true,
      zone: { select: { id: true, name: true, district: true, color: true } },
    },
  })
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } })
  if (!user) throw { status: 404, message: 'Usuario no encontrado' }

  const valid = await bcrypt.compare(currentPassword, user.password)
  if (!valid) throw { status: 401, message: 'La contraseña actual es incorrecta' }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } })
  return { message: 'Contraseña actualizada correctamente' }
}

// ─── RF-01: Registro ──────────────────────────────────────────────────────────

export async function registerUser(input: RegisterInput) {
  const [emailExists, dniExists] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email } }),
    prisma.user.findUnique({ where: { dni: input.dni } }),
  ])

  if (emailExists) {
    throw { status: 409, message: 'El correo electrónico ya está registrado' }
  }
  if (dniExists) {
    throw { status: 409, message: 'El DNI ya está registrado' }
  }

  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS)
  const verificationToken = generateSecureToken()
  const verificationExpiry = addHours(new Date(), VERIFICATION_EXPIRY_HOURS)

  // RF-04: Asignación de zona por punto-en-polígono o distrito como respaldo
  let zoneId: string | null = null
  if (input.lat !== undefined && input.lng !== undefined) {
    const detectedZone = await detectZoneByCoords(input.lat, input.lng)
    if (detectedZone) {
      zoneId = detectedZone.id
    }
  }

  // Respaldo secundario: buscar zona activa por distrito
  if (!zoneId) {
    const matchingZone = await prisma.zone.findFirst({
      where: { district: { equals: input.district, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    })
    if (matchingZone) {
      zoneId = matchingZone.id
    }
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      password: hashedPassword,
      dni: input.dni,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone || null,
      address: input.address,
      district: input.district,
      homeLat: input.lat ?? null,
      homeLng: input.lng ?? null,
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
      zoneId,
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  })

  try {
    await sendVerificationEmail(user.email, user.firstName, verificationToken)
  } catch (emailErr) {
    console.error('Error enviando email de verificación:', emailErr)
  }

  // RF-04.4: si el ciudadano quedó sin zona (pendiente), alertar a los administradores.
  // Best-effort: un fallo aquí nunca debe romper el registro.
  if (!zoneId) {
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { email: true, firstName: true },
      })
      await Promise.all(
        admins.map((admin) =>
          sendPendingZoneAlertEmail(admin.email, admin.firstName, {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            district: input.district,
            address: input.address,
          }),
        ),
      )
    } catch (alertErr) {
      console.error('Error enviando alerta de zona pendiente a administradores:', alertErr)
    }
  }

  return { message: 'Registro exitoso. Revisa tu correo para confirmar tu cuenta.' }
}

// ─── RF-01: Verificar email ───────────────────────────────────────────────────

export async function verifyEmail(token: string) {
  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
    select: {
      id: true,
      emailVerificationExpiry: true,
      isVerified: true,
    },
  })

  if (!user) {
    throw { status: 400, message: 'Token de verificación inválido' }
  }
  if (user.isVerified) {
    throw { status: 400, message: 'Esta cuenta ya fue verificada' }
  }
  if (!user.emailVerificationExpiry || user.emailVerificationExpiry < new Date()) {
    // Limpiar usuario no verificado expirado
    await prisma.user.delete({ where: { id: user.id } })
    throw { status: 400, message: 'El enlace de verificación expiró. Regístrate nuevamente.' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified: true,
      isActive: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    },
  })

  return { message: 'Cuenta verificada exitosamente. Ya puedes iniciar sesión.' }
}

// ─── RF-02: Login ─────────────────────────────────────────────────────────────

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
      firstName: true,
      lastName: true,
      zoneId: true,
      isActive: true,
      isVerified: true,
      lockedUntil: true,
      failedLoginAttempts: true,
    },
  })

  if (!user) {
    throw { status: 401, message: 'Credenciales incorrectas' }
  }

  if (!user.isVerified) {
    throw { status: 401, message: 'Debes verificar tu correo electrónico antes de iniciar sesión' }
  }

  if (!user.isActive) {
    throw { status: 401, message: 'Tu cuenta está desactivada. Contacta al administrador.' }
  }

  // Verificar bloqueo por intentos fallidos
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
    throw {
      status: 423,
      message: `Cuenta bloqueada temporalmente. Intenta en ${minutesLeft} minuto(s).`,
    }
  }

  const passwordValid = await bcrypt.compare(input.password, user.password)

  if (!passwordValid) {
    const newAttempts = user.failedLoginAttempts + 1
    const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: newAttempts,
        lockedUntil: shouldLock ? addMinutes(new Date(), LOCK_DURATION_MINUTES) : null,
      },
    })

    if (shouldLock) {
      throw {
        status: 423,
        message: `Cuenta bloqueada por ${LOCK_DURATION_MINUTES} minutos por múltiples intentos fallidos.`,
      }
    }

    const remaining = MAX_FAILED_ATTEMPTS - newAttempts
    throw {
      status: 401,
      message: `Credenciales incorrectas. Te quedan ${remaining} intento(s) antes del bloqueo.`,
    }
  }

  // Credenciales correctas: resetear intentos y generar tokens
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role })
  const refreshToken = signRefreshToken(user.id)

  const refreshExpiry = addHours(new Date(), 7 * 24)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: refreshExpiry },
    }),
  ])

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      zoneId: user.zoneId,
    },
  }
}

// ─── RF-02: Refresh Token ─────────────────────────────────────────────────────

export async function refreshAccessToken(token: string) {
  let payload: { sub: string }
  try {
    payload = verifyRefreshToken(token)
  } catch {
    throw { status: 401, message: 'Refresh token inválido o expirado' }
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
  })

  if (!stored || stored.expiresAt < new Date()) {
    throw { status: 401, message: 'Sesión expirada. Inicia sesión nuevamente.' }
  }

  if (!stored.user.isActive) {
    throw { status: 401, message: 'Cuenta desactivada' }
  }

  // Rotación de refresh token
  const newAccessToken = signAccessToken({
    sub: stored.user.id,
    email: stored.user.email,
    role: stored.user.role,
  })
  const newRefreshToken = signRefreshToken(stored.user.id)
  const refreshExpiry = addHours(new Date(), 7 * 24)

  await prisma.$transaction([
    prisma.refreshToken.delete({ where: { token } }),
    prisma.refreshToken.create({
      data: { token: newRefreshToken, userId: stored.user.id, expiresAt: refreshExpiry },
    }),
  ])

  return { accessToken: newAccessToken, refreshToken: newRefreshToken }
}

// ─── RF-02: Logout ────────────────────────────────────────────────────────────

export async function logoutUser(refreshToken: string) {
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
}

// ─── RF-01: Reenviar email de verificación ───────────────────────────────────

export async function resendVerificationEmail(email: string) {
  const genericMessage = 'Si el correo está registrado y pendiente de verificación, recibirás un nuevo enlace.'

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, isVerified: true, isActive: true },
  })

  if (!user || user.isVerified) {
    return { message: genericMessage }
  }

  const verificationToken = generateSecureToken()
  const verificationExpiry = addHours(new Date(), VERIFICATION_EXPIRY_HOURS)

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationToken: verificationToken, emailVerificationExpiry: verificationExpiry },
  })

  try {
    await sendVerificationEmail(email, user.firstName, verificationToken)
  } catch (emailErr) {
    console.error('Error reenviando email de verificación:', emailErr)
  }

  return { message: genericMessage }
}

// ─── RF-02: Olvidé mi contraseña ─────────────────────────────────────────────

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, isActive: true, isVerified: true },
  })

  // Siempre retornamos el mismo mensaje (seguridad: no revelar si el email existe)
  const genericMessage = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.'

  if (!user || !user.isActive || !user.isVerified) {
    return { message: genericMessage }
  }

  const resetToken = generateSecureToken()
  const resetExpiry = addHours(new Date(), RESET_EXPIRY_HOURS)

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: resetToken, passwordResetExpiry: resetExpiry },
  })

  try {
    await sendPasswordResetEmail(email, user.firstName, resetToken)
  } catch (emailErr) {
    console.error('Error enviando email de recuperación:', emailErr)
  }

  return { message: genericMessage }
}

// ─── RF-02: Restablecer contraseña ───────────────────────────────────────────

export async function resetPassword(token: string, newPassword: string) {
  const user = await prisma.user.findUnique({
    where: { passwordResetToken: token },
    select: { id: true, passwordResetExpiry: true },
  })

  if (!user) {
    throw { status: 400, message: 'Token de restablecimiento inválido' }
  }

  if (!user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    throw { status: 400, message: 'El enlace de restablecimiento expiró. Solicita uno nuevo.' }
  }

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS)

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpiry: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  })

  // Invalidar todos los refresh tokens del usuario
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } })

  return { message: 'Contraseña restablecida exitosamente. Ya puedes iniciar sesión.' }
}
