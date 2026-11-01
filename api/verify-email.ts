import { withCors, type ApiHandler } from './_lib/http'
import { query } from './_lib/db'

function htmlPage(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:4rem auto;text-align:center">
    <p>${message}</p>
  </body></html>`
}

const handler: ApiHandler = async (req, res) => {
  const token = req.query.token
  if (!token) {
    res.status(400).send(htmlPage('Missing verification token.'))
    return
  }

  try {
    const tokenRow = await query<{ id: number; subscriber_id: number }>(
      `select id, subscriber_id from verification_tokens
       where token = $1 and kind = 'email_verify' and consumed_at is null and expires_at > now()`,
      [token],
    )
    if (tokenRow.rows.length === 0) {
      res.status(400).send(htmlPage('This verification link is invalid or has expired.'))
      return
    }

    const { id, subscriber_id } = tokenRow.rows[0]
    await query(`update verification_tokens set consumed_at = now() where id = $1`, [id])
    // channels.email was already set true at signup time; email_verified is the
    // actual send gate the cron worker checks, kept separately since it's
    // subscriber-wide (one verified address covers every saved location).
    await query(`update subscribers set email_verified = true where id = $1`, [subscriber_id])

    res.status(200).send(htmlPage('Email confirmed — you will now receive storm advisories for your saved location(s).'))
  } catch (err) {
    console.error('/api/verify-email failed:', err)
    res.status(500).send(htmlPage('Something went wrong confirming your email. Try the link again shortly.'))
  }
}

export default withCors(handler)
