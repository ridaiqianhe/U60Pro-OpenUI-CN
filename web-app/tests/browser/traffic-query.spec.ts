import { test, expect } from './support/harness'
import { openApp } from './support/app'
import { trafficQuery } from './support/fixtures'
const path = '/cgi-bin/traffic-query'
test('query reviews official cutoff before sending; Cancel never sends SMS', async ({ page, agent }) => {
  await openApp(page, { group: 'modem', tab: '数据' })
  await expect(page.getByRole('heading', { name: '运营商流量查询' })).toBeVisible()
  expect(agent.mutations()).toEqual([])
  await page.getByRole('button', { name: '查询流量', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('原厂到量自动断网')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
  expect(agent.mutations()).toEqual([])
})
test('one confirmed query is sent and waiting prevents duplicate clicks', async ({ page, agent }) => {
  agent.on('POST', path, { data: { ...trafficQuery(), status: 'waiting' } })
  await openApp(page, { group: 'modem', tab: '数据' })
  await page.getByRole('button', { name: '查询流量', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('button', { name: '查询流量', exact: true })).toBeDisabled()
  expect(agent.mutations()).toHaveLength(1)
  expect(agent.mutations()[0].body).toEqual({ action: 'query' })
})
test('ambiguous SMS is explicit and never claims the official limit is enabled', async ({ page, agent }) => {
  agent.on('GET', path, { data: { ...trafficQuery(), status: 'needs_review', error: '流量包口径不明确' } })
  await openApp(page, { group: 'modem', tab: '数据' })
  await expect(page.getByText('流量包口径不明确')).toBeVisible()
  await expect(page.getByText('短信口径不明确，未改动限额', { exact: false })).toBeVisible()
  expect(agent.mutations()).toEqual([])
})
