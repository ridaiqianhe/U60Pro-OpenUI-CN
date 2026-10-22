import { useState } from 'react'
import { req } from '../../data/client'
import { usePoll } from '../../data/poll'
import { Button } from '../../ui/controls'
import { Card, Chip, InlineStatus } from '../../ui/primitives'
import { toastError } from '../../ui/feedback'

type Cell = { rat: 'NR' | 'LTE'; pci: number; arfcn?: number | null; band?: number | null; rsrp_dbm?: number | null }
type Snapshot = { status: string; cells: Cell[]; sampled_time?: string; age_seconds?: number; stale?: boolean; partial?: boolean; error?: string }
const read = async () => await req('GET', '/cgi-bin/neighbor-scan', undefined, undefined, 10000, window.location.origin) as unknown as Snapshot

export default function Neighbors() {
  const { data, status, error, refresh, mutate } = usePoll('neighbor-scan', read, 3000)
  const [submitting, setSubmitting] = useState(false)
  const collecting = data?.status === 'collecting'
  async function scan() {
    if (submitting || collecting) return
    setSubmitting(true)
    try {
      const next = await req('POST', '/cgi-bin/neighbor-scan', { action: 'scan' }, undefined, 10000, window.location.origin)
      mutate(next as unknown as Snapshot)
    } catch (e) { toastError(e, '启动采集失败；请先刷新状态，不要连续重试') }
    finally { setSubmitting(false) }
  }
  const cells = data?.cells ?? []
  const measured = cells.filter(c => c.rsrp_dbm != null).length
  return <Card title="附近小区">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-ink2">手动采集约 35 秒，读取诊断报告，不切换网络制式或小区锁定。</p>
        <Button size="sm" loading={submitting || collecting} disabled={submitting || collecting || status !== 'ready'} onClick={scan}>
          {collecting ? '采集中…' : '采集附近小区'}
        </Button>
      </div>
      {(status === 'error' || status === 'stale') && <InlineStatus kind="error" action={{ label: '重试读取', onClick: refresh }}>{error ?? '读取失败'}</InlineStatus>}
      {data?.error && <InlineStatus kind="error">{data.error}</InlineStatus>}
      {collecting && <InlineStatus kind="stale">正在采集，下面保留上次结果，请等待完成。</InlineStatus>}
      {data?.sampled_time && <p className="text-meta text-ink2">采集时间（设备时间）：{data.sampled_time} · {cells.length} 条记录 · {measured} 条有信号测量</p>}
      {data?.stale && <InlineStatus kind="stale">结果已超过 5 分钟，仅作历史参考，请重新采集。</InlineStatus>}
      {data?.partial && <InlineStatus kind="stale">部分诊断记录被截断或丢弃，结果可能不完整。</InlineStatus>}
      {cells.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-left text-body">
        <thead><tr className="label border-b border-line/8">{['类型', '频段', 'PCI', 'ARFCN', 'RSRP', '记录'].map(h => <th key={h} className="whitespace-nowrap pb-2 pr-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{cells.map(c => <tr key={`${c.rat}:${c.pci}:${c.arfcn ?? '?'}`} className="border-b border-line/6 last:border-0">
          <td className="py-2 pr-3"><Chip tone={c.rat === 'NR' ? 'nr' : 'lte'}>{c.rat}</Chip></td>
          <td className="tnum whitespace-nowrap py-2 pr-3 font-mono">{c.band != null ? `${c.rat === 'NR' ? 'n' : 'B'}${c.band}` : '—'}</td>
          <td className="tnum py-2 pr-3 font-mono">{c.pci}</td><td className="tnum py-2 pr-3 font-mono">{c.arfcn ?? '—'}</td>
          <td className="tnum whitespace-nowrap py-2 pr-3 font-mono">{c.rsrp_dbm != null ? `${c.rsrp_dbm.toFixed(1)} dBm` : '—'}</td>
          <td className="whitespace-nowrap py-2 text-meta text-ink2">{c.rsrp_dbm != null ? '信号测量' : '仅身份'}</td>
        </tr>)}</tbody>
      </table></div> : !collecting && status === 'ready' && <p className="text-body text-ink2">{data?.status === 'ready' ? '本次未解析出邻小区，不代表附近没有其他小区。' : '尚无采集结果，点击上方按钮开始。'}</p>}
      <p className="text-caption text-ink3">已排除当前服务与聚合载波；仅身份记录未测得信号强度，也不代表可以驻网。结果不会自动用于锁小区。</p>
    </div>
  </Card>
}
