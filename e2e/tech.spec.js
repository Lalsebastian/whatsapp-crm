import { test, expect } from '@playwright/test'
import { useFakeSupabase, openAs } from './support/fakeSupabase.js'
import { trackPageErrors } from './support/pageErrors.js'

test.describe('Technician console', () => {
  test('shows today\'s route for the selected technician', async ({ page }) => {
    const errors = trackPageErrors(page)
    await useFakeSupabase(page)
    await openAs(page, 'tech', '/tech')

    await expect(page.locator('#crm-main').getByRole('heading', { level: 1, name: "Today's field plan" })).toBeVisible()
    await expect(page.getByText('2 jobs')).toBeVisible()
    await expect(page.getByRole('button', { name: /BK-AC1001/ })).toContainText('AC Service & Repair')
    await expect(page.getByRole('button', { name: /BK-PL2002/ })).toContainText('In Progress')

    // Sara's only job was three days ago, so her plan for today is empty.
    await page.getByRole('combobox', { name: 'Preview technician' }).selectOption({ label: 'Sara Ali' })
    await expect(page.getByText('No jobs assigned')).toBeVisible()
    expect(errors()).toEqual([])
  })

  test('starts a job from the job sheet', async ({ page }) => {
    const errors = trackPageErrors(page)
    const backend = await useFakeSupabase(page)
    await openAs(page, 'tech', '/tech')

    await page.getByRole('button', { name: /BK-AC1001/ }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Aisha Khan')).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:971501110001')

    await sheet.getByRole('button', { name: 'Start job' }).click()

    await expect.poll(() => backend.tables.bookings.find((row) => row.id === 'bk-1').status).toBe('in_progress')
    expect(backend.tables.bookings.find((row) => row.id === 'bk-1').started_at).toBeTruthy()
    expect(errors()).toEqual([])
  })

  test('profile shows the technician\'s working capacity', async ({ page }) => {
    await useFakeSupabase(page)
    await openAs(page, 'tech', '/tech?view=profile')
    await expect(page.getByRole('heading', { name: 'Ravi Menon' })).toBeVisible()
    await expect(page.getByText('08:00–17:00')).toBeVisible()
    await expect(page.getByText('40 hours')).toBeVisible()
  })
})
