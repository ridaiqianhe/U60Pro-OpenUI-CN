import { useState } from 'react'
import { TabPanel, Tabs } from '../../ui/Tabs'
import MetricsTab from './MetricsTab'
import ToolsTab from './ToolsTab'
import SettingsTab from './SettingsTab'

type Tab = 'metrics' | 'tools' | 'settings'

export default function SystemGroup({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('metrics')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="hidden font-display text-2xl font-semibold tracking-[-0.015em] text-ink lg:block">系统</h1>
        <p className="lg:mt-0.5 text-body text-ink2">设备状态、诊断工具与系统控制</p>
      </div>

      <Tabs
        tabs={[
          { id: 'metrics', label: "指标" },
          { id: 'tools', label: "工具" },
          { id: 'settings', label: "设置" },
        ]}
        active={tab}
        onChange={setTab}
        label="系统分类"
        idBase="system"
      />

      <TabPanel idBase="system" id={tab} className="space-y-4">
        {tab === 'metrics' && <MetricsTab />}
        {tab === 'tools' && <ToolsTab />}
        {tab === 'settings' && <SettingsTab onLogout={onLogout} />}
      </TabPanel>
    </div>
  )
}
