import { test, expect } from './support/harness'
import * as fx from './support/fixtures'
import { openApp } from './support/app'

for (const width of [320, 375, 390]) {
  test(`mobile pages fit the scroll container at ${width}px`, async ({ page, agent }) => {
    agent.on('GET', '/cgi-bin/wireguard', { data: { installed: true, running: false, autostart: false, configured: false, addresses: [], peers: [] } })
    await page.setViewportSize({ width, height: 844 })
    await openApp(page)
    const check = async (where: string) => {
      const result = await page.locator('main').evaluate((main) => {
        const bounds = main.getBoundingClientRect()
        return { width: main.clientWidth, scroll: main.scrollWidth,
          wide: Array.from(main.querySelectorAll('*')).filter(n => {
            const r = n.getBoundingClientRect()
            return r.width && r.right > bounds.right + 1
          }).slice(0, 10).map(n => `${n.tagName}.${n.className}: ${n.textContent?.slice(0, 45)}`) }
      })
      expect(result, where).toMatchObject({ scroll: result.width })
    }
    await expect(page.getByTestId('home-rsrp')).toBeVisible()
    await check('home')
    for (const group of ['信号', '网络', '移动网络', '系统']) {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: group, exact: true }).filter({ visible: true }).click()
      const tabs = page.getByRole('tab')
      await expect(tabs.first()).toBeVisible()
      for (const tab of await tabs.all()) {
        const label = await tab.innerText()
        await tab.click()
        await expect(page.getByRole('tabpanel')).toBeVisible()
        await check(`${group}/${label}`)
      }
    }
  })
}

for (const width of [320, 375, 390]) {
  test(`home keeps large live rates fully visible at ${width}px`, async ({ page, agent }) => {
    agent.on('GET', '/api/dashboard', { data: fx.dashboard({ speed: { rx_speed: 999_900_000, tx_speed: 999_900_000, max_rx_speed: 999_900_000, max_tx_speed: 999_900_000 } }) })
    await page.setViewportSize({ width, height: 844 })
    await openApp(page)
    await expect(page.getByTestId('home-download')).toBeVisible()
    for (const id of ['home-download', 'home-upload']) {
      const size = await page.getByTestId(id).evaluate(node => {
        const band = node.closest('section')!.getBoundingClientRect()
        const r = node.getBoundingClientRect()
        return { client: node.clientWidth, scroll: node.scrollWidth, inside: r.left >= band.left && r.right <= band.right }
      })
      expect(size, id).toMatchObject({ scroll: size.client, inside: true })
    }
  })
}
