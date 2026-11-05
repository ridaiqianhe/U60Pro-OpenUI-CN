// PLAN2 R11: a LAN change is confirmed before submission; Cancel sends nothing.
import { test, expect } from './support/harness'
import { openApp } from './support/app'

test('Cancel on the LAN confirmation sends nothing; Confirm sends the reviewed settings once', async ({ page, agent }) => {
  await openApp(page, { group: 'network', tab: '路由设置' })
  const ip = page.getByLabel('局域网 IP')
  await expect(ip).toHaveValue('192.168.0.1')
  await ip.fill('192.168.8.1')

  await page.getByRole('button', { name: '应用局域网设置' }).click()
  const dialog = page.getByRole('dialog', { name: '将路由器地址改为 192.168.8.1？' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('192.168.0.1 → 192.168.8.1')
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  expect(agent.mutations()).toEqual([])

  // Unchanged response: the address change is not applied, so no reconnect handshake runs.
  agent.on('PUT', '/api/router/lan', { data: { changed: false } })
  await page.getByRole('button', { name: '应用局域网设置' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
  await expect.poll(() => agent.mutations().length).toBe(1)
  const [put] = agent.mutations()
  expect(put.method).toBe('PUT')
  expect(put.body).toMatchObject({ ipaddr: '192.168.8.1', netmask: '255.255.255.0' })
})

test('a changed LAN confirms through the existing forwarding address without leaving it', async ({ page, agent }) => {
  agent.on('PUT', '/api/router/lan', { data: {
    changed: true, reconnect_ip: '192.168.8.1', confirmation_token: 'scoped-lan-nonce', confirm_within_secs: 120,
  } })
  agent.on('POST', '/api/router/lan/confirm', { data: {} })
  await openApp(page, { group: 'network', tab: '路由设置' })
  await page.getByLabel('局域网 IP').fill('192.168.8.1')
  await page.getByLabel('DHCP 起始地址').fill('192.168.8.2')
  await page.getByLabel('DHCP 结束地址').fill('192.168.8.253')
  await page.getByRole('button', { name: '应用局域网设置' }).click()
  await expect(page.getByRole('dialog')).toContainText('确认前重启')
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('status').filter({ hasText: '正在确认' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '现在可以重启' })).toBeVisible()
  expect(new URL(page.url()).hostname).toBe('127.0.0.1')
  const [confirmation] = agent.requests({ method: 'POST', path: '/api/router/lan/confirm' })
  expect(confirmation.body).toEqual({ token: 'scoped-lan-nonce' })
  expect(confirmation.headers.authorization).toBeUndefined()
})

test('an unfinished transition is visible after reopening settings', async ({ page, agent }) => {
  const fx = await import('./support/fixtures')
  agent.on('GET', '/api/router/lan', { data: { ...fx.lan(), transition: { pending: true, remaining_secs: 70 } } })
  await openApp(page, { group: 'network', tab: '路由设置' })
  await expect(page.getByRole('status').filter({ hasText: '尚未确认' })).toBeVisible()
  await expect(page.getByRole('button', { name: '应用局域网设置' })).toBeDisabled()
})

test('an older response without confirmation status is not reported as saved', async ({ page, agent }) => {
  agent.on('PUT', '/api/router/lan', { data: {} })
  await openApp(page, { group: 'network', tab: '路由设置' })
  await page.getByRole('button', { name: '应用局域网设置' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('status').filter({ hasText: '设备没有返回局域网确认状态' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '现在可以重启' })).toHaveCount(0)
})
