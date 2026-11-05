import { useState } from 'react'
import { TabPanel, Tabs } from '../../ui/Tabs'
import ClientsTab from './ClientsTab'
import WifiTab from './WifiTab'
import RouterTab from './RouterTab'
import WireGuardTab from './WireGuardTab'
import TailscaleTab from './TailscaleTab'

type Tab = 'clients' | 'wifi' | 'router' | 'wireguard' | 'tailscale'

export default function NetworkGroup() {
  const [tab, setTab] = useState<Tab>('clients')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="hidden font-display text-2xl font-semibold tracking-[-0.015em] text-ink lg:block">网络</h1>
        <p className="lg:mt-0.5 text-body text-ink2">连接设备、Wi-Fi 与路由设置</p>
      </div>

      <Tabs
        tabs={[
          { id: 'clients', label: "连接设备" },
          { id: 'wifi', label: "Wi-Fi" },
          { id: 'router', label: "路由设置" },
          { id: 'wireguard', label: "WireGuard" },
          { id: 'tailscale', label: "Tailscale" },
        ]}
        active={tab}
        onChange={setTab}
        label="网络分类"
        idBase="network"
        wrap
      />

      <TabPanel idBase="network" id={tab} className="space-y-4">
        {tab === 'clients' && <ClientsTab />}
        {tab === 'wifi' && <WifiTab />}
        {tab === 'router' && <RouterTab />}
        {tab === 'wireguard' && <WireGuardTab />}
        {tab === 'tailscale' && <TailscaleTab />}
      </TabPanel>
    </div>
  )
}
