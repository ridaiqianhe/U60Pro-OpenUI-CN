import type { Page } from '@playwright/test'
import { test, expect, type MockAgent } from './support/harness'
import { openApp } from './support/app'
import * as fx from './support/fixtures'

// PLAN2 R07/R08/R11/U03 — Modem > APN. Every mutation is a mocked request.

type Json = Record<string, unknown>

interface ApnState {
  mode: number
  profiles: Json[]
}

const PROFILES = (activeId: string | null): Json[] => [
  { profilename: 'Synthetic Internet', wanapn: 'internet.example', username: 'syn-user', password: 'syn-secret-pass', pdpType: 3, pppAuthMode: 1, profileId: '1', isEnable: activeId === '1' },
  { profilename: 'Synthetic M2M', wanapn: 'm2m.example', username: '', password: '', pdpType: 1, pppAuthMode: 0, profileId: '2', isEnable: activeId === '2' },
]

/** A stateful APN endpoint set that mimics the agent: activation sets manual mode, then enables the profile. */
function apnAgent(agent: MockAgent, initial: Partial<ApnState> = {}): ApnState {
  const state: ApnState = { mode: 0, profiles: PROFILES(null), ...initial }
  agent.on('GET', '/api/router/apn/mode', () => ({ data: fx.apnMode({ apn_mode: state.mode }) }))
  agent.on('GET', '/api/router/apn/profiles', () => ({ data: fx.apnProfiles({ apnListArray: state.profiles }) }))
  agent.on('PUT', '/api/router/apn/mode', (req) => {
    state.mode = (req.body as { apn_mode: number }).apn_mode
    return { data: {} }
  })
  agent.on('POST', '/api/router/apn/profiles/activate', (req) => {
    const id = (req.body as { profileId: string }).profileId
    state.mode = 1
    state.profiles = state.profiles.map((p) => ({ ...p, isEnable: p.profileId === id }))
    return { data: {} }
  })
  return state
}

const modeGroup = (page: Page) => page.getByRole('radiogroup', { name: 'APN 模式' })
const radio = (page: Page, name: string) => modeGroup(page).getByRole('radio', { name })
const checked = (page: Page, name: string) => expect(radio(page, name)).toHaveAttribute('aria-checked', 'true')

test.describe('activation and mode stay coherent', () => {
  test('automatic -> activate a profile -> both panels show manual and Automatic stays selectable', async ({ page, agent }) => {
    apnAgent(agent, { mode: 0 })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await checked(page, '自动')

    await page.getByRole('button', { name: 'Activate Synthetic M2M' }).click()
    const dialog = page.getByRole('dialog', { name: /Activate APN profile "Synthetic M2M"/ })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Mobile data reconnects')
    await expect(dialog).toContainText('m2m.example')
    await expect(dialog).toContainText('Automatic → Manual')
    // Credentials are never echoed into a confirmation.
    await expect(dialog).not.toContainText('syn-secret-pass')
    await dialog.getByRole('button', { name: 'Activate', exact: true }).click()

    // Mode panel and profile panel both reflect the authoritative state.
    await checked(page, '手动')
    await expect(page.getByText('Active', { exact: true })).toHaveCount(1)
    await expect(page.locator('div', { hasText: /^Synthetic M2M/ }).getByText('Active', { exact: true }).first()).toBeVisible()
    await expect(radio(page, '自动')).toBeEnabled()

    expect(agent.requests({ method: 'POST', path: '/api/router/apn/profiles/activate' }).map((r) => r.body)).toEqual([{ profileId: '2' }])
    expect(agent.mutations()).toHaveLength(1)

    // Returning to Automatic is possible: select, Apply, confirm.
    await radio(page, '自动').click()
    await expect(page.getByRole('button', { name: '应用' })).toBeEnabled()
    expect(agent.mutations()).toHaveLength(1)
  })

  test('manual -> automatic: draft, Apply, confirm, one PUT, then both panels re-read', async ({ page, agent }) => {
    const state = apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await checked(page, '手动')
    await expect(page.getByRole('button', { name: '应用' })).toBeDisabled()

    await radio(page, '自动').click()
    await checked(page, '自动')
    expect(agent.mutations()).toEqual([])

    await page.getByRole('button', { name: '应用' }).click()
    const dialog = page.getByRole('dialog', { name: 'Switch APN mode to automatic?' })
    await expect(dialog).toContainText('Manual → Automatic')
    await expect(dialog).toContainText('Mobile data reconnects')
    await dialog.getByRole('button', { name: 'Switch to automatic' }).click()

    await expect(page.getByRole('button', { name: '应用' })).toBeDisabled()
    await checked(page, '自动')
    expect(state.mode).toBe(0)
    expect(agent.requests({ method: 'PUT', path: '/api/router/apn/mode' }).map((r) => r.body)).toEqual([{ apn_mode: 0 }])
    expect(agent.mutations()).toHaveLength(1)
    // Coordinated read-back of both resources after the accepted change.
    await expect.poll(() => agent.requests({ method: 'GET', path: '/api/router/apn/mode' }).length).toBe(2)
    await expect.poll(() => agent.requests({ method: 'GET', path: '/api/router/apn/profiles' }).length).toBe(2)
    // In automatic mode the stored selection is not shown as the active APN.
    await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Selected', { exact: true })).toHaveCount(1)
  })
})

test.describe('no accidental submissions', () => {
  test('Cancel in the mode confirmation sends nothing and keeps the draft', async ({ page, agent }) => {
    apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await radio(page, '自动').click()
    await page.getByRole('button', { name: '应用' }).click()
    const dialog = page.getByRole('dialog', { name: 'Switch APN mode to automatic?' })
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    expect(agent.mutations()).toEqual([])
    await checked(page, '自动')
  })

  test('Cancel and Escape in the activation confirmation send nothing', async ({ page, agent }) => {
    apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await page.getByRole('button', { name: 'Activate Synthetic M2M' }).click()
    const dialog = page.getByRole('dialog', { name: /Activate APN profile/ })
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Activate Synthetic M2M' }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(agent.mutations()).toEqual([])
  })

  test('arrow keys on the mode radiogroup only change the draft; nothing is sent until Apply is confirmed', async ({ page, agent }) => {
    apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await radio(page, '手动').focus()
    await page.keyboard.press('ArrowLeft')
    await checked(page, '自动')
    await page.keyboard.press('ArrowRight')
    await checked(page, '手动')
    await page.keyboard.press('ArrowLeft')
    await checked(page, '自动')
    expect(agent.mutations()).toEqual([])
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: '应用' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Switch to automatic' }).click()
    await expect(page.getByRole('button', { name: '应用' })).toBeDisabled()
    expect(agent.requests({ method: 'PUT', path: '/api/router/apn/mode' }).map((r) => r.body)).toEqual([{ apn_mode: 0 }])
  })

  test('while an operation is pending every conflicting control is locked', async ({ page, agent }) => {
    const state = apnAgent(agent, { mode: 0 })
    const hold = agent.defer('POST', '/api/router/apn/profiles/activate')
    await openApp(page, { group: 'modem', tab: 'APN' })
    await page.getByRole('button', { name: 'Activate Synthetic M2M' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Activate', exact: true }).click()
    await hold.waitForRequest()

    await expect(page.getByRole('button', { name: 'Activate Synthetic Internet' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '新增 APN 配置' })).toBeDisabled()
    await expect(radio(page, '手动')).toBeDisabled()
    await expect(page.getByRole('button', { name: '应用' })).toBeDisabled()
    // A deferred reply bypasses apnAgent's handler, so apply the router's side effect here;
    // otherwise the coordinated read-back would (correctly) report Automatic again.
    const id = ((await hold.waitForRequest()).body as { profileId: string }).profileId
    state.mode = 1
    state.profiles = state.profiles.map((p) => ({ ...p, isEnable: p.profileId === id }))
    hold.resolve({})
    await checked(page, '手动')
    expect(agent.mutations()).toHaveLength(1)
  })
})

test.describe('honest read and write states', () => {
  test('accepted change with a failed read-back is reported as unverified and is not retried', async ({ page, agent }) => {
    apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await radio(page, '自动').click()
    // From now on every read fails.
    agent.on('GET', '/api/router/apn/mode', { error: 'synthetic read failure', status: 503 })
    agent.on('GET', '/api/router/apn/profiles', { error: 'synthetic read failure', status: 503 })
    await page.getByRole('button', { name: '应用' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Switch to automatic' }).click()

    await expect(page.getByText(/accepted the change, but the current APN state could not be confirmed/)).toBeVisible()
    await checked(page, '自动') // the accepted value, not a rollback
    expect(agent.requests({ method: 'PUT', path: '/api/router/apn/mode' })).toHaveLength(1)
    expect(agent.mutations()).toHaveLength(1)

    // Re-reading is explicit and succeeds once reads work again.
    agent.on('GET', '/api/router/apn/mode', () => ({ data: fx.apnMode({ apn_mode: 0 }) }))
    agent.on('GET', '/api/router/apn/profiles', () => ({ data: fx.apnProfiles() }))
    await page.getByRole('button', { name: '重新读取 APN 状态' }).click()
    await expect(page.getByText(/could not be confirmed/)).toBeHidden()
    expect(agent.mutations()).toHaveLength(1)
  })

  test('a profiles read failure shows an error with Retry, never "暂无手动 APN 配置"; mode stays independent', async ({ page, agent }) => {
    apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    agent.fail('GET', '/api/router/apn/profiles', { status: 503, error: 'synthetic outage' })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await expect(page.getByText(/APN profiles could not be read/)).toBeVisible()
    await expect(page.getByText('暂无手动 APN 配置')).toHaveCount(0)
    await checked(page, '手动')

    agent.on('GET', '/api/router/apn/profiles', () => ({ data: fx.apnProfiles() }))
    await page.getByRole('button', { name: '重试' }).click()
    await expect(page.getByText('Synthetic Internet')).toBeVisible()
  })

  test('a genuinely empty profile list is an empty state, not an error', async ({ page, agent }) => {
    apnAgent(agent, { mode: 0, profiles: [] })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await expect(page.getByText('暂无手动 APN 配置')).toBeVisible()
    await expect(page.getByText(/could not be read/)).toHaveCount(0)
  })

  test('a missing apn_mode is unknown, not automatic: no radio is checked', async ({ page, agent }) => {
    apnAgent(agent)
    agent.on('GET', '/api/router/apn/mode', { data: {} })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await expect(page.getByText(/does not recognise/)).toBeVisible()
    await expect(radio(page, '自动')).toHaveAttribute('aria-checked', 'false')
    await expect(radio(page, '手动')).toHaveAttribute('aria-checked', 'false')
    await radio(page, '自动').click()
    await expect(page.getByRole('button', { name: '应用' })).toBeEnabled()
    expect(agent.mutations()).toEqual([])
  })

  test('a failed activation reports the error, sends one request and shows the router state', async ({ page, agent }) => {
    apnAgent(agent, { mode: 0 })
    agent.on('POST', '/api/router/apn/profiles/activate', { error: 'synthetic activation failure', status: 503 })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await page.getByRole('button', { name: 'Activate Synthetic M2M' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Activate', exact: true }).click()
    await expect(page.getByText('synthetic activation failure')).toBeVisible()
    // The backend rolled back to automatic; the panels show what the router reports.
    await checked(page, '自动')
    await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
    expect(agent.requests({ method: 'POST', path: '/api/router/apn/profiles/activate' })).toHaveLength(1)
    await expect(page.getByText(/accepted the change/)).toHaveCount(0)
  })

  test('a failed profile save keeps the form draft, including the password, and sends no extra request', async ({ page, agent }) => {
    apnAgent(agent)
    agent.on('POST', '/api/router/apn/profiles', { error: 'synthetic add failure', status: 400 })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await page.getByRole('button', { name: '新增 APN 配置' }).click()
    await page.getByLabel('配置名称').fill('Draft Profile')
    await page.getByRole('textbox', { name: 'APN', exact: true }).fill('draft.example')
    await page.getByLabel('密码').fill('draft-secret')
    await page.getByRole('button', { name: '新增配置' }).click()

    await expect(page.getByText('synthetic add failure')).toBeVisible()
    await expect(page.getByLabel('配置名称')).toHaveValue('Draft Profile')
    await expect(page.getByRole('textbox', { name: 'APN', exact: true })).toHaveValue('draft.example')
    await expect(page.getByLabel('密码')).toHaveValue('draft-secret')
    const posts = agent.requests({ method: 'POST', path: '/api/router/apn/profiles' })
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({ profilename: 'Draft Profile', wanapn: 'draft.example', password: 'draft-secret' })
    expect(agent.mutations()).toHaveLength(1)
  })

  test('deleting a profile keeps its confirmation and drops the redundant success toast', async ({ page, agent }) => {
    const state = apnAgent(agent, { mode: 1, profiles: PROFILES('1') })
    agent.on('POST', '/api/router/apn/profiles/delete', (req) => {
      state.profiles = state.profiles.filter((p) => p.profileId !== (req.body as { profileId: string }).profileId)
      return { data: {} }
    })
    await openApp(page, { group: 'modem', tab: 'APN' })
    await page.getByRole('button', { name: 'Delete Synthetic M2M' }).click()
    await page.getByRole('dialog', { name: /Delete APN profile "Synthetic M2M"/ }).getByRole('button', { name: '删除' }).click()
    await expect(page.getByText('Synthetic M2M')).toHaveCount(0)
    await expect(page.locator('[data-toast]')).toHaveCount(0)
    expect(agent.requests({ method: 'POST', path: '/api/router/apn/profiles/delete' }).map((r) => r.body)).toEqual([{ profileId: '2' }])
  })
})
