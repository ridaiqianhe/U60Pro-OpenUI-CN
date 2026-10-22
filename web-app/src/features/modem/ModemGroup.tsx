import { useState } from 'react'
import { TabPanel, Tabs } from '../../ui/Tabs'
import ApnTab from './ApnTab'
import DataTab from './DataTab'
import TtlTab from './TtlTab'
import SmsTab from './SmsTab'
import SmsForwardTab from './SmsForwardTab'

type Tab = 'apn' | 'data' | 'ttl' | 'sms' | 'sms-forward'

export default function ModemGroup() {
  const [tab, setTab] = useState<Tab>('apn')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="hidden font-display text-2xl font-semibold tracking-[-0.015em] text-ink lg:block">移动网络</h1>
        <p className="lg:mt-0.5 text-body text-ink2">APN 配置、流量、TTL 与短信</p>
      </div>

      <Tabs
        tabs={[
          { id: 'apn', label: 'APN' },
          { id: 'data', label: "数据" },
          { id: 'ttl', label: 'TTL' },
          { id: 'sms', label: "短信" },
          { id: 'sms-forward', label: "短信转发" },
        ]}
        active={tab}
        onChange={setTab}
        label="移动网络分类"
        idBase="modem"
      />

      <TabPanel idBase="modem" id={tab} className="space-y-4">
        {tab === 'apn' && <ApnTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'ttl' && <TtlTab />}
        {tab === 'sms' && <SmsTab />}
        {tab === 'sms-forward' && <SmsForwardTab />}
      </TabPanel>
    </div>
  )
}
