import { env } from '../config/env'

async function sendMail(to: string, subject: string, html: string) {
  if (!env.brevoApiKey) {
    console.log('\n📧 EMAIL (modo consola — configura BREVO_API_KEY para envío real):')
    console.log(`   Para: ${to}`)
    console.log(`   Asunto: ${subject}`)
    const linkMatch = html.match(/href="([^"]+)"/)
    if (linkMatch) console.log(`   ✅ Link: ${linkMatch[1]}`)
    console.log('')
    return
  }

  const senderMatch = env.emailFrom.match(/^(.+?)\s*<(.+)>$/)
  const senderName = senderMatch ? senderMatch[1].trim() : 'Sistema de Recolección'
  const senderEmail = senderMatch ? senderMatch[2].trim() : env.emailFrom

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.brevoApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      headers: {
        'X-Mailin-click': '0'
      }
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`Brevo error ${res.status}: ${(body as { message?: string }).message ?? res.statusText}`)
  }
}

export async function sendVerificationEmail(to: string, firstName: string, token: string) {
  const link = `${env.frontendUrl}/verify-email?token=${token}`
  await sendMail(to, 'Confirma tu cuenta — Sistema de Recolección', verificationTemplate(firstName, link))
}

export async function sendPasswordResetEmail(to: string, firstName: string, token: string) {
  const link = `${env.frontendUrl}/reset-password?token=${token}`
  await sendMail(to, 'Recupera tu contraseña — Sistema de Recolección', resetPasswordTemplate(firstName, link))
}

export async function sendZoneAssignedEmail(
  to: string,
  firstName: string,
  zoneName: string,
  district: string,
) {
  await sendMail(
    to,
    'Tu zona de recolección fue asignada — Sistema de Recolección',
    baseTemplate(`
      <h2 style="color:#1e293b;font-size:20px;margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:600;">¡Tu zona fue asignada!</h2>
      <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Estimado(a) <strong>${firstName}</strong>, el administrador asignó tu cuenta a la zona de recolección:
      </p>
      <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:0 0 24px;border:1px solid #bbf7d0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;font-size:13px;color:#64748b;">Zona</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#0f766e;">${zoneName}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b;">Distrito: <strong>${district}</strong></p>
      </div>
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Ahora recibirás notificaciones y horarios específicos para tu zona.
      </p>
    `),
  )
}

// RF-04.4: alerta al administrador cuando un ciudadano queda sin zona (pendiente)
export async function sendPendingZoneAlertEmail(
  to: string,
  adminFirstName: string,
  citizen: { firstName: string; lastName: string; email: string; district: string; address: string },
) {
  await sendMail(
    to,
    'Ciudadano pendiente de asignación de zona — Sistema de Recolección',
    baseTemplate(`
      <h2 style="color:#1e293b;font-size:18px;margin:0 0 16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Asignación de zona pendiente</h2>
      <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Estimado(a) <strong>${adminFirstName}</strong>, un nuevo ciudadano se registró pero su domicilio no pertenece a ninguna zona de recolección activa. Requiere asignación manual de zona.
      </p>
      <div style="background:#fffbeb;border-radius:6px;padding:20px;margin:0 0 24px;border:1px solid #fde68a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Ciudadano</p>
        <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1e293b;">${citizen.firstName} ${citizen.lastName}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Correo</p>
        <p style="margin:0 0 16px;font-size:14px;color:#475569;">${citizen.email}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Distrito</p>
        <p style="margin:0 0 16px;font-size:14px;color:#475569;">${citizen.district}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Dirección</p>
        <p style="margin:0;font-size:14px;color:#475569;">${citizen.address}</p>
      </div>
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Ingresa al panel de usuarios para asignarle una zona de recolección.
      </p>
    `),
  )
}

export async function sendIncidentStatusEmail(
  to: string,
  firstName: string,
  trackingCode: string,
  newStatus: string,
) {
  const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Abierta',
    IN_REVIEW: 'En revisión',
    RESOLVED: 'Resuelta',
    CLOSED: 'Cerrada',
  }
  const label = STATUS_LABELS[newStatus] ?? newStatus
  await sendMail(
    to,
    `Tu incidencia fue actualizada — Sistema de Recolección`,
    incidentStatusTemplate(firstName, trackingCode, label),
  )
}

export async function sendRouteDelayEmail(
  to: string,
  firstName: string,
  routeName: string,
  delayMinutes: number,
  reason?: string,
) {
  await sendMail(
    to,
    'Alerta de retraso en ruta de recoleccion',
    baseTemplate(`
      <h2 style="color:#1e293b;font-size:18px;margin:0 0 16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Retraso en la recoleccion</h2>
      <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Estimado(a) <strong>${firstName}</strong>, le informamos que la ruta de recoleccion asignada a su zona presenta una demora.
      </p>
      <div style="background:#fffbeb;border-radius:6px;padding:20px;margin:0 0 24px;border:1px solid #fde68a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Ruta</p>
        <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1e293b;">${routeName}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Retraso estimado</p>
        <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#b45309;">${delayMinutes} minutos</p>
        ${reason ? `<p style="margin:0 0 4px;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Motivo</p><p style="margin:0;font-size:14px;color:#475569;">${reason}</p>` : ''}
      </div>
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Evite sacar sus residuos hasta que la ruta se normalice.
      </p>
    `),
  )
}

// ─── Templates HTML ───────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sistema de Recolección</title>
</head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);border:1px solid #f1f5f9;">
          <tr>
            <td style="background:#0f766e;padding:32px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:600;letter-spacing:-0.025em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Sistema de Recolección</h1>
              <p style="color:#ccfbf1;margin:6px 0 0;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.025em;text-transform:uppercase;">Gobierno Municipal</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:24px 32px;text-align:center;border-top:1px solid #f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="color:#94a3b8;font-size:11px;line-height:1.5;margin:0;">
                Gobierno Municipal — Sistema de Recolección de Residuos Sólidos<br>
                Si no solicitaste esta comunicación, por favor ignora este correo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function verificationTemplate(firstName: string, link: string): string {
  return baseTemplate(`
    <h2 style="color:#1e293b;font-size:18px;margin:0 0 16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Estimado(a) ${firstName},</h2>
    <p style="color:#475569;line-height:1.6;margin:0 0 24px;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Gracias por registrarte en el Sistema de Recolección. Para activar tu cuenta y acceder a los horarios y rutas de recolección de tu sector, te solicitamos confirmar tu dirección de correo electrónico.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${link}"
         style="background:#0f766e;color:#ffffff;padding:12px 28px;border-radius:6px;
                text-decoration:none;font-weight:500;font-size:15px;display:inline-block;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                box-shadow:0 2px 4px rgba(15,118,110,0.15);">
        Confirmar cuenta
      </a>
    </div>
    <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Este enlace de confirmación expira en <strong>24 horas</strong>.<br>
      Si tienes inconvenientes con el botón, copia y pega el siguiente enlace en tu navegador:<br>
      <a href="${link}" style="color:#0f766e;word-break:break-all;text-decoration:none;font-weight:500;">${link}</a>
    </p>
  `)
}

function incidentStatusTemplate(firstName: string, trackingCode: string, statusLabel: string): string {
  return baseTemplate(`
    <h2 style="color:#1e293b;font-size:18px;margin:0 0 16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Actualización de Incidencia</h2>
    <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Estimado(a) <strong>${firstName}</strong>, le informamos que el estado de su reporte ha sido actualizado en el sistema.
    </p>
    <div style="background:#f8fafc;border-radius:6px;padding:20px;margin:0 0 24px;border:1px solid #f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Código de seguimiento</p>
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1e293b;font-family:Consolas,monaco,monospace;">${trackingCode}</p>
      <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Nuevo estado</p>
      <p style="margin:0;font-size:15px;font-weight:600;color:#0f766e;">${statusLabel}</p>
    </div>
    <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Puede realizar el seguimiento detallado de su reporte ingresando al panel de incidencias en la aplicación.
    </p>
  `)
}

function resetPasswordTemplate(firstName: string, link: string): string {
  return baseTemplate(`
    <h2 style="color:#1e293b;font-size:18px;margin:0 0 16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Recuperación de Contraseña</h2>
    <p style="color:#475569;line-height:1.6;margin:0 0 24px;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Estimado(a) <strong>${firstName}</strong>, hemos recibido una solicitud para restablecer la contraseña asociada a tu cuenta.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${link}"
         style="background:#0f766e;color:#ffffff;padding:12px 28px;border-radius:6px;
                text-decoration:none;font-weight:500;font-size:15px;display:inline-block;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                box-shadow:0 2px 4px rgba(15,118,110,0.15);">
        Restablecer contraseña
      </a>
    </div>
    <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      Este enlace de recuperación expira en <strong>1 hora</strong>.<br>
      Si no has solicitado este cambio, puedes ignorar este correo de forma segura.
    </p>
  `)
}

export async function sendRouteAssignedEmail(
  to: string,
  firstName: string,
  routeName: string,
  startTime: string | null,
  dayOfWeek: number[]
) {
  const daysStr = dayOfWeek.map((d) => {
    const names = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
    return names[d] ?? ''
  }).join(', ')

  await sendMail(
    to,
    'Nueva ruta de recolección asignada — Sistema de Recolección',
    baseTemplate(`
      <h2 style="color:#1e293b;font-size:18px;margin:0 0 16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Nueva ruta asignada</h2>
      <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Estimado(a) <strong>${firstName}</strong>, se le ha asignado el rol de operador para una nueva ruta de recolección:
      </p>
      <div style="background:#f8fafc;border-radius:6px;padding:20px;margin:0 0 24px;border:1px solid #f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Nombre de la Ruta</p>
        <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1e293b;">${routeName}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Horario de Inicio</p>
        <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#0f766e;">${startTime ?? 'No definido'}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Días de Recolección</p>
        <p style="margin:0;font-size:14px;color:#475569;">${daysStr}</p>
      </div>
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Por favor, ingrese a la aplicación en el horario indicado para iniciar su ruta.
      </p>
    `)
  )
}

