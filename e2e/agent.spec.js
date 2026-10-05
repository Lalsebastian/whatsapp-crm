import { test, expect } from '@playwright/test'
import { useFakeSupabase, openAs } from './support/fakeSupabase.js'
import { trackPageErrors } from './support/pageErrors.js'

test.describe('Agent console', () => {
  test('inbox lists conversations and opens a thread (read-only)', async ({ page }) => {
    const errors = trackPageErrors(page)
    await useFakeSupabase(page)
    await openAs(page, 'agent', '/agent')

    await expect(page.locator('#crm-main').getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
    await expect(page.getByText('Read-only. Reply in the WhatsApp Business app.')).toBeVisible()
    // Most recent conversation is open by default.
    await expect(page.getByText('The tap is leaking again')).toBeVisible()

    await page.getByRole('button', { name: /\+9715 01 11 0001/ }).click()
    await expect(page.getByText('Book AC service tomorrow morning')).toBeVisible()
    // No send control: replies happen in WhatsApp Business.
    await expect(page.getByRole('textbox', { name: /reply|message/i })).toHaveCount(0)
    expect(errors()).toEqual([])
  })

  test('escalations: resolves a handoff and records the resolution time', async ({ page }) => {
    const errors = trackPageErrors(page)
    const backend = await useFakeSupabase(page)
    await openAs(page, 'agent', '/agent?view=escalations')

    await expect(page.getByText('1 escalations')).toBeVisible()
    await expect(page.getByText('Customer wants to speak to a supervisor about the leak.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:971501110002')

    await page.getByRole('combobox', { name: 'Change escalation status for 971501110002' }).click()
    await page.getByRole('option', { name: 'Resolved' }).click()

    await expect.poll(() => backend.tables.escalations[0].status).toBe('resolved')
    expect(backend.tables.escalations[0].resolved_at).toBeTruthy()
    expect(errors()).toEqual([])
  })

  test('bookings: assigns a technician to an unassigned booking', async ({ page }) => {
    const errors = trackPageErrors(page)
    const backend = await useFakeSupabase(page)
    await openAs(page, 'agent', '/agent?view=bookings')

    const assign = page.getByRole('table').getByRole('combobox', { name: 'Assign technician for BK-AC4004' })
    await expect(assign).toHaveValue('')
    await assign.selectOption({ label: 'Sara Ali' })

    await expect.poll(() => backend.tables.bookings.find((row) => row.id === 'bk-4').technician_id).toBe('tech-sara')
    expect(errors()).toEqual([])
  })

  test('board shows the open complaint', async ({ page }) => {
    const errors = trackPageErrors(page)
    await useFakeSupabase(page)
    await openAs(page, 'agent', '/agent?view=board')
    await expect(page.getByText(/Kitchen tap is leaking again/).first()).toBeVisible()
    expect(errors()).toEqual([])
  })
})
