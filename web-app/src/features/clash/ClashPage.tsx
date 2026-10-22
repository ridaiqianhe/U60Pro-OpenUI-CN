import { useCallback, useEffect, useState } from 'react'
import { req } from '../../data/client'
import { Button, Field, Input, Toggle } from '../../ui/controls'
import { Card } from '../../ui/primitives'

export default function ClashPage() {
  const [url, setUrl] = useState('')
  const [panel, setPanel] = useState('')
  const [configured, setConfigured] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [transparent, setTransparent] = useState(false)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [frame, setFrame] = useState(0)
  const connect = useCallback(async () => {
    const data = await req('GET', '/cgi-bin/mihomo-connect', undefined, undefined, 8000, '')
    if (typeof data.url !== 'string') throw new Error('无法读取面板连接信息')
    const target = new URL(data.url)
    if (target.hostname !== window.location.hostname || target.port !== '9091' || target.pathname !== '/ui/') throw new Error('面板地址不匹配')
    setPanel(target.toString())
  }, [])
  useEffect(() => {
    let active = true
    Promise.all([connect(), req('GET', '/cgi-bin/mihomo-subscription', undefined, undefined, 8000, '')])
      .then(([, data]) => {
        if (active) {
          setConfigured(data.configured === true)
          setTransparent(data.transparent === true)
          setLoaded(true)
          const s = data.summary as { nodes?: number; groups?: number; rules?: number } | undefined
          if (s) setSummary(`${s.nodes ?? 0} 个节点 · ${s.groups ?? 0} 个分组 · ${s.rules ?? 0} 条规则`)
        }
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '加载失败') })
    return () => { active = false }
  }, [connect])
  async function apply(refresh: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      await req('POST', '/cgi-bin/mihomo-subscription', refresh ? { action: 'refresh' } : { action: 'save', url: url.trim() }, undefined, 90000, '')
      const status = await req('GET', '/cgi-bin/mihomo-subscription', undefined, undefined, 8000, '')
      const counts = status.summary as { nodes?: number; groups?: number; rules?: number } | undefined
      if (counts) setSummary(`${counts.nodes ?? 0} 个节点 · ${counts.groups ?? 0} 个分组 · ${counts.rules ?? 0} 条规则`)
      setConfigured(true); setTransparent(status.transparent === true); setUrl(''); setMessage('订阅的节点、分组和规则已更新，代理开关保持原状态。'); setFrame(f => f + 1)
    } catch (e) { setError(e instanceof Error ? e.message : '订阅更新失败') }
    finally { setBusy(false) }
  }
  async function toggle(enabled: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      const status = await req('POST', '/cgi-bin/mihomo-transparent', { enabled }, undefined, 30000, '')
      setTransparent(status.transparent === true)
      setMessage(enabled ? '透明代理已开启。' : '透明代理已关闭，设备恢复直连。')
    } catch (e) { setError(e instanceof Error ? e.message : '切换失败') }
    finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <h1 className="font-display text-2xl font-semibold">Clash 代理</h1>
    <Card title="透明代理">
      <div className="flex items-center justify-between gap-4">
        <div><p className="font-medium text-ink">{!loaded ? '读取状态…' : transparent ? 'ON · 按规则分流' : 'OFF · 直接连接'}</p>
        <p className="mt-1 text-meta text-ink3">关闭后保留 Clash 面板与节点；开关状态在重启和订阅更新后保留。</p></div>
        <Toggle label="透明代理总开关" checked={transparent} disabled={!loaded || busy} onChange={enabled => void toggle(enabled)} />
      </div>
    </Card>
    {error && <p role="alert" className="text-body text-danger">{error}</p>}
    {message && <p role="status" className="text-body text-ok">{message}</p>}
    <Card title="订阅管理">
      <p className="mb-3 text-body text-ink2">{configured ? '已保存订阅，可更新或替换。' : '尚未添加订阅。粘贴服务商提供的 Clash / Mihomo YAML 订阅链接。'}</p>
      {summary && <p className="mb-3 font-mono text-meta text-ink2">{summary}</p>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void apply(false) }}>
        <Field label="订阅链接"><Input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!url.trim()} loading={busy}>保存并应用</Button>
          <Button type="button" onClick={() => void apply(true)} disabled={!configured || busy}>更新订阅</Button>
        </div>
      </form>
    </Card>
    <div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">Clash 面板</h2><Button onClick={() => { void connect().then(() => setFrame(f => f + 1)).catch(e => setError(String(e))) }}>刷新面板</Button></div>
    {panel ? <iframe key={frame} title="Clash 内嵌管理面板" src={panel} referrerPolicy="no-referrer" className="h-[75vh] min-h-96 w-full rounded-panel border border-line/10 bg-surface" /> : <p className="text-body text-ink3">正在连接面板…</p>}
  </div>
}
