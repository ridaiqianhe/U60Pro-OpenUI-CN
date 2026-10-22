import { test, expect } from './support/harness'
import { openApp } from './support/app'

test.use({ authenticated: false })

test('a rejected trusted-source check falls back to Chinese password login', async ({ page, agent }) => {
  await page.goto('/')
  await expect(page.getByLabel('管理密码')).toBeVisible()
  expect(agent.requests({ method: 'POST', path: '/cgi-bin/wg-login' })).toHaveLength(1)
  expect(agent.requests({ path: '/api/dashboard' })).toHaveLength(0)
  await page.getByLabel('管理密码').fill('synthetic-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  expect(agent.requests({ method: 'POST', path: '/api/auth/login' })[0].body).toEqual({ password: 'synthetic-password' })
  expect(agent.mutations()).toEqual([])
})

test('a successful trusted-source check opens the dashboard without a password', async ({ page, agent }) => {
  agent.on('POST', '/cgi-bin/wg-login', { data: { token: 'synthetic-trusted-token' } })
  await openApp(page)
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
  await expect(page.getByLabel('管理密码')).toHaveCount(0)
  expect(agent.requests({ method: 'POST', path: '/cgi-bin/wg-login' })[0].body).toEqual({})
  expect(agent.requests({ method: 'POST', path: '/api/auth/login' })).toHaveLength(0)
  expect(await page.evaluate(() => sessionStorage.getItem('zte_token'))).toBe('synthetic-trusted-token')
})

test('explicit logout stays on the password page even for a trusted source', async ({ page, agent }) => {
  agent.on('POST', '/cgi-bin/wg-login', { data: { token: 'synthetic-trusted-token' } })
  await openApp(page, { group: 'system', tab: '设置' })
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('管理密码')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('zte_token'))).toBeNull()
  expect(agent.requests({ method: 'POST', path: '/cgi-bin/wg-login' })).toHaveLength(1)
})
