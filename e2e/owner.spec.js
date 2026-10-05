import { test, expect } from '@playwright/test'
import { useFakeSupabase, openAs } from './support/fakeSupabase.js'
import { trackPageErrors } from './support/pageErrors.js'

test.describe('Owner console', () => {
  test('overview shows KPIs computed from CRM records and renders the lazy charts', async ({ page }) => {
    const errors = trackPageErrors(page)
    await useFakeSupabase(page)
    await openAs(page, 'owner', '/owner')

    const main = page.locator('#crm-main')
    await expect(main.getByRole('heading', { level: 1, name: 'Executive overview' })).toBeVisible()
    // One completed booking (Home Cleaning, AED 200) in the default period.
    const revenue = main.locator('.kpi-card').filter({ hasText: 'Sum of 1 completed jobs in this period' })
    await expect(revenue).toContainText('Revenue')
    await expect(revenue).toContainText('AED 200')

    // The lazily loaded Chart.js chunk renders the revenue chart.
    const revenueChart = main.locator('div').filter({ has: page.getByText('Revenue over time', { exact: true }) }).locator('canvas')
    await revenueChart.first().scrollIntoViewIfNeeded()
    await expect(revenueChart.first()).toBeVisible()

    expect(errors()).toEqual([])
  })

  test('bookings: lists records and changes a status with an undo toast', async ({ page }) => {
    const errors = trackPageErrors(page)
    const backend = await useFakeSupabase(page)
    await openAs(page, 'owner', '/owner?view=bookings')

    const table = page.getByRole('table')
    await expect(table.getByText('BK-AC1001')).toBeVisible()
    await expect(table.getByText('BK-PL2002')).toBeVisible()

    await table.getByRole('combobox', { name: 'Change status for BK-AC1001' }).click()
    await page.getByRole('option', { name: 'Completed' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Booking status updated' })).toBeVisible()
    await expect.poll(() => backend.tables.bookings.find((row) => row.id === 'bk-1').status).toBe('completed')
    expect(backend.writes).toContainEqual(expect.objectContaining({ table: 'bookings', method: 'PATCH', ids: ['bk-1'] }))

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => backend.tables.bookings.find((row) => row.id === 'bk-1').status).toBe('confirmed')
    expect(errors()).toEqual([])
  })

  test('navigates between modules from the sidebar', async ({ page }) => {
    const errors = trackPageErrors(page)
    await useFakeSupabase(page)
    await openAs(page, 'owner', '/owner')

    await page.getByRole('link', { name: /Complaints/ }).click()
    await expect(page).toHaveURL(/view=complaints/)
    await expect(page.getByText('CM-LEAK01').first()).toBeVisible()

    await page.getByRole('link', { name: /Escalations/ }).click()
    await expect(page).toHaveURL(/view=escalations/)
    const escalation = page.getByRole('table').getByRole('row', { name: /Omar Haddad/ })
    await expect(escalation).toContainText('explicit_human_request')
    await expect(escalation).toContainText('Open')
    expect(errors()).toEqual([])
  })
})
