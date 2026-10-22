import { useCallback, useEffect, useState } from 'react'
import { req } from '../../data/client'
import { formatBytes } from '../../format'
import { Button, Toggle } from '../../ui/controls'
import { Card, Row } from '../../ui/primitives'

type Status = { configured?: boolean; running?: boolean; autostart?: boolean; handshake?: number; rx?: number; tx?: number }
export default function WireGuardTab() {
  const [status, setStatus] = useState<Status>({})
  const [config, setConfig] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => {
    const data = await req('GET', '/cgi-bin/wireguard', undefined, undefined, 10000, '')
    setStatus(data); setLoaded(true)
  }, [])
  useEffect(() => {
    let active = true
    const update = () => { if (active) void refresh().catch(e => { if (active) setError(String(e)) }) }
    update()
    const timer = setInterval(update, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [refresh])
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setMessage('')
    try {
      setStatus(await req('POST', '/cgi-bin/wireguard', { action, ...extra }, undefined, 30000, ''))
      if (action === 'save') { setConfig(''); setMessage('配置已导入，尚未连接。') }
      else setMessage('设置已应用。')
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <Card title="WireGuard">
      <div className="flex items-center justify-between gap-4">
        <div><p className="font-medium text-ink">{!loaded ? '读取状态…' : status.running ? 'ON · 接口已启动' : 'OFF · 未连接'}</p>
        <p className="mt-1 text-meta text-ink3">内网互联可与 Clash 同时开启；仅全局隧道需要关闭 Clash。以握手时间确认连接成功。</p></div>
        <Toggle label="WireGuard 连接" checked={status.running === true} disabled={!loaded || busy || !status.configured} onChange={on => void act(on ? 'start' : 'stop')} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-line/10 pt-4">
        <div><p className="font-medium text-ink">开机自动连接</p><p className="mt-1 text-meta text-ink3">与手动连接独立；内网配置可在 Clash 开启时自动连接。</p></div>
        <Toggle label="WireGuard 开机自动连接" checked={status.autostart === true} disabled={!loaded || busy || !status.configured} onChange={enabled => void act('autostart', { enabled })} />
      </div>
      <div className="mt-4 border-t border-line/10 pt-2">
        <Row label="配置" value={status.configured ? '已导入' : '未导入'} />
        <Row label="Latest handshake" value={status.handshake ? new Date(status.handshake * 1000).toLocaleString() : '尚无握手'} />
        <Row label="RX / TX" value={`${formatBytes(status.rx ?? 0)} / ${formatBytes(status.tx ?? 0)}`} mono />
      </div>
    </Card>
    {error && <p role="alert" className="text-body text-danger">{error}</p>}
    {message && <p role="status" className="text-body text-ok">{message}</p>}
    <Card title="导入配置">
      <p className="mb-3 text-body text-ink2">上传标准 WireGuard .conf 文件，或粘贴配置。替换前请断开连接；保存后不自动启动。</p>
      <label className="block text-meta text-ink2">选择 .conf 文件<input type="file" accept=".conf,text/plain" disabled={busy || status.running} className="mt-2 block w-full text-body" onChange={e => {
        const file = e.target.files?.[0]
        if (!file) return
        if (file.size > 32768) { setError('配置文件不能超过 32 KiB'); return }
        void file.text().then(setConfig).catch(() => setError('无法读取文件'))
      }} /></label>
      <label className="mt-4 block text-meta text-ink2">WireGuard 配置<textarea value={config} onChange={e => setConfig(e.target.value)} disabled={busy || status.running} autoComplete="off" spellCheck={false} placeholder={'[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …\nAllowedIPs = 10.10.0.0/24'} className="mt-2 min-h-64 w-full rounded-control border border-line/15 bg-surface p-3 font-mono text-sm text-ink outline-none focus:border-accent" /></label>
      <p className="my-3 text-meta text-ink3">密钥只保存在设备，不回显已保存配置。支持 Address、MTU 与多 Peer；DNS 字段保留，但暂不更改系统 DNS。不执行 PreUp / PostUp 等脚本钩子。</p>
      <Button variant="primary" disabled={!config.trim() || status.running || busy} loading={busy} onClick={() => void act('save', { config })}>保存配置</Button>
    </Card>
  </div>
}
