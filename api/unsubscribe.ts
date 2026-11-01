import { withCors, type ApiHandler } from './_lib/http'
import { query } from './_lib/db'

function htmlPage(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:4rem auto;text-align:center">
    <p>${message}</p>
  </body></html>`
}

// No login required, single click — required for CAN-SPAM compliance.
// Idempotent: revisiting an already-used unsubscribe link still confirms
// success rather than erroring, since the underlying subscription is already inactive.
const handler: ApiHandler = async (req, res) => {
  const token = req.query.token
  if (!token) {
    res.status(400).send(htmlPage('Missing unsubscribe token.'))
    return
  }

  try {
    const tokenRow = await query<{ id: number; subscription_id: number | null }>(
      `select id, subscription_id from verification_tokens
       where token = $1 and kind = 'unsubscribe' and expires_at > now()`,
      [token],
    )
    if (tokenRow.rows.length === 0 || tokenRow.rows[0].subscription_id === null) {
      res.status(400).send(htmlPage('This unsubscribe link is invalid or has expired.'))
      return
    }

    const { id, subscription_id } = tokenRow.rows[0]
    await query(`update subscriptions set active = false where id = $1`, [subscription_id])
    await query(`update verification_tokens set consumed_at = now() where id = $1 and consumed_at is null`, [id])

    res.status(200).send(htmlPage('You have been unsubscribed from advisories for this location.'))
  } catch (err) {
    console.error('/api/unsubscribe failed:', err)
    res.status(500).send(htmlPage('Something went wrong. Try the link again shortly.'))
  }
}

export default withCors(handler)
