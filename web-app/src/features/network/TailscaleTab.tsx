import { useRef, useState } from 'react'
import { req } from '../../data/client'
import { usePoll } from '../../data/poll'
import { Button, Field, Input, Toggle } from '../../ui/controls'
import { Card, Chip, InlineStatus, Row } from '../../ui/primitives'
import { confirm } from '../../ui/feedback'

type State = { installed: boolean; running: boolean; autostart: boolean; version: string; hostname: string; control_url: string; backend_state: string; online: boolean; addresses: string[]; peer_count: number; dns_name: string; login_url?: string; health: string[] }
const endpoint = '/cgi-bin/tailscale'
const read = async () => await req('GET', endpoint, undefined, undefined, 10000, window.location.origin) as unknown as State
const labels: Record<string, string> = { Stopped: '已停止', Starting: '正在启动', NeedsLogin: '等待账号授权', NeedsMachineAuth: '等待管理员批准', Running: '已连接', StoppedState: '已断开' }
export default function TailscaleTab() {
  const { data, error, refresh, mutate } = usePoll('tailscale', read, 5000)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [editing, setEditing] = useState(false)
  const [hostname, setHostname] = useState('u60pro')
  const [server, setServer] = useState('')
  async function act(action: string, body: Record<string, unknown> = {}) {
    if (lock.current) return
    lock.current = true
    if (action === 'stop' || action === 'logout') {
      if (!await confirm({ title: action === 'logout' ? '退出 Tailscale 账号？' : '停止 Tailscale？', body: '通过 Tailscale 访问此设备的连接会断开。', kind: 'connection', confirmLabel: action === 'logout' ? '退出账号' : '停止连接', recovery: '可通过设备 Wi-Fi、USB 网络或现有 WireGuard 重新进入面板。' })) { lock.current = false; return }
    }
    setBusy(true); setFailure('')
    try {
      const result = await req('POST', endpoint, { action, ...body }, undefined, 20000, window.location.origin) as unknown as State
      mutate(result)
      if (action === 'save') setEditing(false)
    } catch (e) { setFailure(e instanceof Error ? e.message : '操作失败') }
    finally { lock.current = false; setBusy(false) }
  }
  if (!data) return <InlineStatus kind={error ? 'error' : 'info'} action={{ label: '重试', onClick: refresh }}>{error ? '无法读取 Tailscale 扩展，请检查设备端是否已安装。' : '正在读取 Tailscale 状态…'}</InlineStatus>
  const connected = data.backend_state === 'Running' && data.online
  const validHostname = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
  let validServer = !server
  try { const u = new URL(server); validServer = u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' && u.hostname.includes('.') } catch { /* An empty value selects the official control server. */ }
  let loginUrl: string | undefined
  try {
    const u = new URL(data.login_url ?? '')
    const origin = data.control_url ? new URL(data.control_url).origin : 'https://login.tailscale.com'
    if (u.protocol === 'https:' && u.origin === origin && !u.username && !u.password) loginUrl = u.href
  } catch { /* No valid authorization link has been issued. */ }
  return <div className="space-y-4" aria-label="Tailscale 设置">
    <Card title="Tailscale" action={<Chip tone={connected ? 'ok' : 'default'}>{labels[data.backend_state] ?? data.backend_state}</Chip>}>
      <p className="mb-4 text-body text-ink2">把 U60 加入你的 Tailscale 内网，可从同一 Tailnet 远程访问面板和 SSH。</p>
      {!data.installed && <InlineStatus kind="warn">设备尚未安装 Tailscale 核心，请按项目的 Tailscale 部署文档安装。</InlineStatus>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !data.installed || data.running} onClick={() => void act('start')}>启动连接</Button>
        <Button disabled={busy || !data.running} onClick={() => void act('stop')}>停止连接</Button>
        <Button disabled={busy || !data.running} onClick={() => void act('sync')}>完成授权后刷新</Button>
        {data.running && <Button disabled={busy} onClick={() => void act('logout')}>退出账号</Button>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line/10 pt-3"><span className="text-body text-ink">开机自动连接</span><Toggle label="Tailscale 开机自动连接" checked={data.autostart} disabled={busy || !data.installed} onChange={enabled => void act('autostart', { enabled })} /></div>
      <div className="mt-3 space-y-1"><Row label="Version" value={data.version || '未安装'} mono /><Row label="设备名称" value={data.hostname} /><Row label="Tailscale IP" value={data.addresses.length ? data.addresses.join(' · ') : '等待分配'} mono wrap /><Row label="DNS name" value={data.dns_name || '—'} wrap /><Row label="Peers" value={String(data.peer_count)} mono /></div>
      <p className="mt-3 text-meta text-ink3">内网模式：不接管 DNS、不接收子网路由、不使用出口节点。远程 SSH 使用设备原有的 2222 端口。</p>
    </Card>
    {loginUrl && <Card title="账号授权"><p className="mb-3 text-body text-ink2">在浏览器中登录并确认加入你的 Tailnet，然后返回此处刷新。</p><a className="inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 text-body font-medium text-onaccent" href={loginUrl} target="_blank" rel="noopener noreferrer">打开 Tailscale 授权页面 ↗</a><p className="mt-3 text-meta text-ink3">授权链接仅供设备管理员使用，请勿公开分享。</p></Card>}
    <Card title="连接配置" action={!editing && <Button disabled={busy || data.running} onClick={() => { setHostname(data.hostname); setServer(data.control_url); setEditing(true) }}>编辑连接配置</Button>}>
      {editing ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (validHostname && validServer) void act('save', { hostname, control_url: server }) }}>
        <Field label="Tailscale 设备名称"><Input value={hostname} onChange={e => setHostname(e.target.value)} maxLength={63} autoComplete="off" /></Field>
        <Field label="控制服务器（留空使用 Tailscale 官方）"><Input value={server} onChange={e => setServer(e.target.value)} placeholder="https://headscale.example.com" autoComplete="off" /></Field>
        {(!validHostname || !validServer) && <p role="alert" className="text-meta text-danger">设备名称需为小写字母、数字及中划线；控制服务器需为 HTTPS 地址。</p>}
        <div className="flex gap-2"><Button type="submit" disabled={busy || !validHostname || !validServer}>保存连接配置</Button><Button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</Button></div>
      </form> : <><Row label="控制服务器" value={data.control_url || 'Tailscale 官方'} wrap /><p className="mt-2 text-meta text-ink3">支持自己的 Headscale 控制服务器；停止连接后可编辑。</p></>}
    </Card>
    {(failure || error) && <InlineStatus kind="error" action={{ label: '刷新状态', onClick: refresh }}>{failure || error}</InlineStatus>}
    {!!data.health.length && <InlineStatus kind="warn">{data.health.join('；')}</InlineStatus>}
  </div>
}
