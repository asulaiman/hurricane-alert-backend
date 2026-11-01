import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { notifyTestFailure } from './notify-test-failure.mjs'

const config = {
  outcome: 'failure',
  cancelled: 'false',
  webhookUrl: 'https://hooks.slack.com/services/SYNTHETIC/NOT/REAL',
  service: 'Frontend',
  repository: 'asulaiman/hurricane-alert',
  ref: 'refs/heads/main',
  runUrl: 'https://github.com/asulaiman/hurricane-alert/actions/runs/123',
}

for (const outcome of ['success', 'cancelled', 'skipped', undefined]) {
  test(`does not send for ${outcome}`, async () => {
    const sent = await notifyTestFailure({ ...config, outcome, webhookUrl: undefined }, () => {
      assert.fail('Should not send a Slack message')
    })
    assert.equal(sent, false)
  })
}

test('does not send a failure notification during cancellation', async () => {
  assert.equal(await notifyTestFailure({ ...config, cancelled: 'true' }, () => {
    assert.fail('Should not send during cancellation')
  }), false)
})

test('posts safely encoded metadata and the failed-run URL on failure', async () => {
  let calls = 0
  const ref = 'feature/"quotes"\\newline\n<!channel>'
  assert.equal(await notifyTestFailure({ ...config, ref }, async (url, options) => {
    calls += 1
    assert.equal(url, config.webhookUrl)
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    const payload = JSON.parse(options.body)
    assert.ok(payload.blocks[0].text.text.includes(ref))
    assert.equal(payload.blocks[0].text.type, 'plain_text')
    assert.ok(payload.text.includes('&lt;!channel&gt;'))
    assert.ok(payload.text.includes(config.service))
    assert.ok(payload.text.includes(config.repository))
    assert.ok(payload.text.includes(config.runUrl))
    return new Response('ok')
  }), true)
  assert.equal(calls, 1)
})

test('reports missing webhook setup explicitly', async () => {
  await assert.rejects(notifyTestFailure({ ...config, webhookUrl: undefined }),
    /SLACK_WEBHOOK_URL is not configured/)
})

for (const webhookUrl of ['not-a-url', 'http://hooks.slack.com/services/test', 'https://example.test/services/test']) {
  test(`rejects an invalid webhook destination without making a request: ${webhookUrl}`, async () => {
    await assert.rejects(notifyTestFailure({ ...config, webhookUrl }, () => {
      assert.fail('Should not send to an invalid destination')
    }), /SLACK_WEBHOOK_URL/)
  })
}

test('surfaces notification HTTP failures', async () => {
  await assert.rejects(notifyTestFailure(config, async () => new Response('error', { status: 403 })),
    /Slack notification failed \(HTTP 403\)/)
})

test('surfaces network failures without disclosing a webhook URL', async () => {
  await assert.rejects(notifyTestFailure(config, async () => {
    throw new Error(`Network error for ${config.webhookUrl}`)
  }), (error) => {
    assert.equal(error.message, 'Slack notification request failed or timed out.')
    assert.ok(!error.message.includes(config.webhookUrl))
    return true
  })
})

test('does not treat an unexpected response as confirmed delivery', async () => {
  await assert.rejects(notifyTestFailure(config, async () => new Response('unexpected')),
    /Slack did not acknowledge/)
})

for (const [outcome, cancelled, expectedStatus] of [
  ['success', 'false', 0],
  ['failure', 'true', 0],
  ['failure', 'false', 1],
]) {
  test(`CLI preserves notification status for ${outcome}, cancelled=${cancelled}`, () => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./notify-test-failure.mjs', import.meta.url)),
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SLACK_WEBHOOK_URL: '',
        TEST_OUTCOME: outcome,
        TEST_CANCELLED: cancelled,
      },
    })
    assert.equal(result.status, expectedStatus)
    if (expectedStatus === 1) assert.match(result.stderr, /SLACK_WEBHOOK_URL is not configured/)
    else assert.equal(result.stderr, '')
  })
}
