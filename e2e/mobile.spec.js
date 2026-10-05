// Phone-sized checks (Pixel 7 project): technicians use the console on site.
import { test, expect } from '@playwright/test'
import { useFakeSupabase, openAs } from './support/fakeSupabase.js'
import { trackPageErrors } from './support/pageErrors.js'

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

for (const [role, path, heading] of [
  ['tech', '/tech', "Today's field plan"],
  ['agent', '/agent', 'Inbox'],
  ['owner', '/owner', 'Executive overview'],
]) {
  test(`${role} console fits a phone screen without horizontal scrolling`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await useFakeSupabase(page)
    await openAs(page, role, path)
    await expect(page.locator('#crm-main').getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expectNoHorizontalScroll(page)
    expect(errors()).toEqual([])
  })
}

test('a technician can open and start a job on a phone', async ({ page }) => {
  const backend = await useFakeSupabase(page)
  await openAs(page, 'tech', '/tech')
  await page.getByRole('button', { name: /BK-AC1001/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start job' }).click()
  await expect.poll(() => backend.tables.bookings.find((row) => row.id === 'bk-1').status).toBe('in_progress')
})
