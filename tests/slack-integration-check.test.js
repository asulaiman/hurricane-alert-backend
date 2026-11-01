import { expect, it } from 'vitest'

it('intentionally fails to verify the backend CI failure alert', () => {
  expect(true, 'Intentional API failure for authorized Slack integration check').toBe(false)
})
