import { Resend } from 'resend'

const FROM = process.env.RESEND_FROM || 'alerts@example.com'
const MAILING_ADDRESS = process.env.MAILING_ADDRESS || '[Set MAILING_ADDRESS in .env.local — required by CAN-SPAM]'

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  return new Resend(apiKey)
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const client = getClient()
  if (!client) {
    console.log(`[mail:dev] RESEND_API_KEY not set — would have sent to ${to}\nSubject: ${subject}\n${html}`)
    return
  }
  const { error } = await client.emails.send({ from: FROM, to, subject, html })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await send(
    to,
    'Confirm your Hurricane Alert email subscription',
    `<p>Click to confirm you want storm advisories at this address:</p>
     <p><a href="${verifyUrl}">${verifyUrl}</a></p>
     <p>If you didn't request this, ignore this email — you won't be subscribed.</p>`,
  )
}

export async function sendAdvisoryEmail(
  to: string,
  subject: string,
  bodyHtml: string,
  unsubscribeUrl: string,
): Promise<void> {
  await send(
    to,
    subject,
    `${bodyHtml}
     <hr>
     <p style="font-size:12px;color:#666">
       ${MAILING_ADDRESS}<br>
       <a href="${unsubscribeUrl}">Unsubscribe</a> from these alerts.
     </p>`,
  )
}
