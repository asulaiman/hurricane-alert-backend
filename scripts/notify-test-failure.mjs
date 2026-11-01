import { pathToFileURL } from 'node:url'

export async function notifyTestFailure(config, fetchImpl = globalThis.fetch) {
  if (config.outcome !== 'failure' || config.cancelled === 'true') return false
  if (!config.webhookUrl) throw new Error('SLACK_WEBHOOK_URL is not configured; see README setup instructions.')

  let webhook
  try {
    webhook = new URL(config.webhookUrl)
  } catch {
    throw new Error('SLACK_WEBHOOK_URL is not a valid incoming webhook URL.')
  }
  if (webhook.protocol !== 'https:' || webhook.hostname !== 'hooks.slack.com' ||
      !webhook.pathname.startsWith('/services/')) {
    throw new Error('SLACK_WEBHOOK_URL must be an HTTPS Slack incoming webhook.')
  }

  const text = [
    `${config.service} tests failed`,
    `Repository: ${config.repository}`,
    `Branch/ref: ${config.ref}`,
    `Failed run: ${config.runUrl}`,
  ].join('\n')
  const payload = {
    text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    blocks: [{ type: 'section', text: { type: 'plain_text', text } }],
  }
  let response
  try {
    response = await fetchImpl(webhook.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('Slack notification request failed or timed out.')
  }
  if (!response.ok) throw new Error(`Slack notification failed (HTTP ${response.status}).`)
  if ((await response.text()).trim() !== 'ok') {
    throw new Error('Slack did not acknowledge the failure notification.')
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  notifyTestFailure({
    outcome: process.env.TEST_OUTCOME,
    cancelled: process.env.TEST_CANCELLED,
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    service: process.env.TEST_SERVICE,
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.TEST_REF,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
