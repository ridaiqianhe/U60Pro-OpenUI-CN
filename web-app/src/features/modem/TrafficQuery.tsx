import { useEffect, useRef, useState } from 'react'
import { req } from '../../data/client'
import { usePoll } from '../../data/poll'
import { Button, Toggle } from '../../ui/controls'
import { confirm } from '../../ui/feedback'
import { Card, InlineStatus, Row } from '../../ui/primitives'

type Result = { total_bytes: number; used_bytes: number; remaining_bytes: number }
type Status = { auto_sync: boolean; carrier?: string; carrier_name: string; status: string; error?: string; result?: Result; query_at?: string; applied_at?: string; official: { enabled: boolean; total_bytes?: number; used_bytes?: number; auto_disconnect: boolean } }
const formatAllowance = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} GB`
const read = async () => await req('GET', '/cgi-bin/traffic-query', undefined, undefined, 10000, window.location.origin) as unknown as Status
const labels: Record<string, string> = { ready: '等待查询', sending: '正在发送查询短信', waiting: '已发送，等待运营商短信', applying: '正在同步原厂设置', applied: '已同步到原厂流量限制', parsed: '已解析，自动同步未开启', needs_review: '短信口径不明确，未改动限额', timeout: '等待回复超时', error: '同步失败', uncertain: '结果不明，请检查设备；不会自动重发', send_failed: '短信发送失败' }
export default function TrafficQuery({ onApplied }: { onApplied: () => void }) {
  const { data, error, refresh, mutate } = usePoll('traffic-query', read, 5000)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const lock = useRef(false)
  const lastApplied = useRef<string | undefined>(undefined)
  // Publish a newly observed calibration into the shared dashboard heartbeat.
  useEffect(() => {
    if (data?.applied_at && lastApplied.current !== data.applied_at) { lastApplied.current = data.applied_at; onApplied() }
  }, [data?.applied_at, onApplied])
  async function act(body: Record<string, unknown>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setFailure('')
    try {
      if ((body.action === 'query' && data?.auto_sync) || (body.action === 'auto_sync' && body.enabled)) {
        if (!await confirm({ title: '查询后自动设置原厂流量上限？', body: '收到可明确识别的国内通用流量汇总后，将校准本月已用量、设置套餐总量，并开启原厂到量自动断网。定向或口径不明的流量不会自动套用。', confirmLabel: '确认', kind: 'connection', recovery: '可在原厂流量设置中关闭限制；关闭本页自动同步只停止后续覆盖。' })) return
      }
      const result = await req('POST', '/cgi-bin/traffic-query', body, undefined, 30000, window.location.origin) as unknown as Status
      mutate(result)
    } catch (e) { setFailure(e instanceof Error ? e.message : '请求失败') }
    finally { lock.current = false; setBusy(false) }
  }
  const waiting = data && ['sending', 'waiting', 'applying'].includes(data.status)
  return <Card title="运营商流量查询">
    {!data ? <InlineStatus kind={error ? 'error' : 'info'} action={{ label: '重试', onClick: refresh }}>{error ? '无法读取原厂流量限制' : '正在读取流量查询状态…'}</InlineStatus> : <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-body text-ink2">{data.carrier_name} · {labels[data.status] ?? data.status}</p><Button variant="primary" disabled={busy || !!waiting || !data.carrier} onClick={() => void act({ action: 'query' })}>查询流量</Button></div>
      <div className="flex items-center justify-between gap-4"><div><p className="text-body font-medium text-ink">自动同步原厂限制</p><p className="mt-1 text-meta text-ink3">查询及每日定时查询的有效回复都会同步；达到上限由原厂断网。</p></div><Toggle label="自动同步原厂限制" checked={data.auto_sync} disabled={busy || !!waiting} onChange={enabled => void act({ action: 'auto_sync', enabled })} /></div>
      <div className="space-y-1"><Row label="原厂限制" value={data.official.enabled ? '已开启' : '未开启'} /><Row label="套餐上限" value={data.official.total_bytes == null ? '暂无数据' : formatAllowance(data.official.total_bytes)} /><Row label="本月已用" value={data.official.used_bytes == null ? '暂无数据' : formatAllowance(data.official.used_bytes)} /><Row label="到量自动断网" value={data.official.auto_disconnect ? '已开启' : '未开启'} />{data.applied_at && <Row label="上次同步" value={data.applied_at} />}</div>
      {data.result && <p className="text-meta text-ink2">短信汇总：总量 {formatAllowance(data.result.total_bytes)} · 已用 {formatAllowance(data.result.used_bytes)} · 剩余 {formatAllowance(data.result.remaining_bytes)}</p>}
      <p className="text-meta text-ink3">仅处理启用后新收到的运营商回复，不使用历史短信。短信 GB 按原厂 1024 MB 换算；已用量校准后会继续累计。换卡后重新查询，不继承上一张卡的短信。</p>
      {(failure || data.error || error) && <InlineStatus kind="warn" action={{ label: '刷新状态', onClick: refresh }}>{failure || data.error || '状态刷新失败'}</InlineStatus>}
    </div>}
  </Card>
}
