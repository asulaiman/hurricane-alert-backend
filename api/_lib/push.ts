import webpush from 'web-push'

let configured = false

function ensureConfigured(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
  }
  return true
}

export interface StoredPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function sendPushNotification(
  subscription: StoredPushSubscription,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!ensureConfigured()) {
    console.log(`[push:dev] VAPID keys not set — would have sent: ${payload.title}`)
    return
  }
  await webpush.sendNotification(subscription, JSON.stringify(payload))
}
