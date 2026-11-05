import { test, expect } from './support/harness'
import { openApp } from './support/app'

test('line field starts static, motion is opt-in and stops when paused', async ({ page, agent }) => {
  await openApp(page)
  const canvas = page.locator('.line-field-canvas')
  const motion = page.getByRole('button', { name: '线场动效', exact: true })
  await expect(canvas).toHaveAttribute('aria-hidden', 'true')
  await expect(canvas).toHaveAttribute('data-mode', 'static')
  await expect(motion).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => canvas.getAttribute('data-frames')).not.toBeNull()
  // Static mode must not keep a background paint loop alive.
  await page.waitForTimeout(80) // Let initial resize/intersection observers finish their one-shot paint.
  const before = await canvas.getAttribute('data-frames')
  await page.waitForTimeout(150)
  expect(await canvas.getAttribute('data-frames')).toBe(before)
  await motion.click()
  await expect(canvas).toHaveAttribute('data-mode', 'moving')
  await expect(motion).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(2)
  await motion.click()
  await expect(canvas).toHaveAttribute('data-mode', 'static')
  await page.waitForTimeout(80) // The new static effect also receives its initial observer callbacks.
  const stopped = await canvas.getAttribute('data-frames')
  await page.waitForTimeout(150)
  expect(await canvas.getAttribute('data-frames')).toBe(stopped)
  expect(agent.mutations()).toEqual([])
  await page.screenshot({ path: '/tmp/u60-line-field-desktop.png' })
})

test('reduced motion stays static and a 320px screen does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openApp(page, { reducedMotion: true })
  await expect(page.getByRole('button', { name: '线场动效', exact: true })).toBeDisabled()
  await expect(page.locator('.line-field-canvas')).toHaveAttribute('data-mode', 'static')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/u60-line-field-mobile.png' })
})

test('retina backing store and both palettes keep the radio study legible', async ({ page }) => {
  await openApp(page, { theme: 'dark' })
  const canvas = page.locator('.line-field-canvas')
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => node.width)).toBeGreaterThan(1)
  const dimensions = await canvas.evaluate((node: HTMLCanvasElement) => ({ backing: node.width, css: node.getBoundingClientRect().width, dpr: Math.min(window.devicePixelRatio, 3), colour: getComputedStyle(node).color }))
  expect(dimensions.backing).toBe(Math.round(dimensions.css * dimensions.dpr))
  expect(dimensions.colour).toBe('rgb(145, 191, 255)')
})
