import { useState } from 'react'
import { TabPanel, Tabs } from '../../ui/Tabs'
import Overview from './Overview'
import Locking from './Locking'
import Neighbors from './Neighbors'

type Tab = 'overview' | 'locking' | 'neighbors'

export default function SignalGroup() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="hidden font-display text-2xl font-semibold tracking-[-0.015em] text-ink lg:block">信号</h1>
        <p className="lg:mt-0.5 text-body text-ink2">实时无线指标、频段与小区锁定</p>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: "概览" },
          { id: 'locking', label: "模式与锁定" },
          { id: 'neighbors', label: "附近小区" },
        ]}
        active={tab}
        onChange={setTab}
        label="信号分类"
        idBase="signal"
      />

      <TabPanel idBase="signal" id={tab} className="space-y-4">
        {tab === 'overview' ? <Overview /> : tab === 'neighbors' ? <Neighbors /> : <Locking />}
      </TabPanel>
    </div>
  )
}
