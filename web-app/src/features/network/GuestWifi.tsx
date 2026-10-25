import { useRef, useState, type ComponentProps } from 'react'
import { req } from '../../data/client'
import { usePoll } from '../../data/poll'
import { Button, Field, Input, Select, Toggle as ToggleControl } from '../../ui/controls'
import { confirm } from '../../ui/feedback'
import { Card, InlineStatus } from '../../ui/primitives'

function Toggle(props: ComponentProps<typeof ToggleControl>) {
  return <div className="flex min-w-0 max-w-full items-center justify-between gap-3"><span className="min-w-0 text-body text-ink2">{props.label}</span><ToggleControl {...props} /></div>
}

type Band = { ssid: string; enabled: boolean; radio_enabled: boolean; broadcast: boolean; encryption: string; password_set: boolean; pmf: boolean; qr: boolean; isolate: boolean; max_clients: number; duration_hours: number; remaining_seconds?: number; running: boolean; clients: number }
type Snapshot = { bands: Record<'2g' | '5g', Band>; sync_enabled?: boolean; lan_access?: boolean; duration_options: number[]; security_options: string[] }
type Settings = Pick<Band, 'ssid' | 'enabled' | 'broadcast' | 'encryption' | 'pmf' | 'qr' | 'isolate' | 'max_clients'> & { password?: string }
const read = async () => await req('GET', '/cgi-bin/guest-wifi', undefined, undefined, 10000, window.location.origin) as unknown as Snapshot
const modes: Record<string, string> = { none: '无加密', 'psk2+ccmp': 'WPA2 Personal', 'psk-mixed+tkip+ccmp': 'WPA / WPA2 Personal', 'sae-mixed': 'WPA2 / WPA3 Personal', sae: 'WPA3 Personal' }
const draftOf = (b: Band): Settings => ({ ssid: b.ssid, enabled: b.enabled, broadcast: b.broadcast, encryption: b.encryption, pmf: b.pmf, qr: b.qr, isolate: b.isolate, max_clients: b.max_clients })
const remaining = (b: Band) => !b.enabled ? '已关闭' : b.duration_hours === 0 ? '不限时' : b.remaining_seconds == null ? '等待设备报告剩余时间' : `剩余 ${Math.floor(b.remaining_seconds / 3600)} 小时 ${Math.floor(b.remaining_seconds % 3600 / 60)} 分钟`
function BandForm({ band, label, suffix, busy, options, save }: { band: Band; label: string; suffix: '2g' | '5g'; busy: boolean; options: string[]; save: (body: Record<string, unknown>, title: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<Settings | null>(null)
  const [show, setShow] = useState(false)
  const set = (value: Partial<Settings>) => setDraft(d => d && ({ ...d, ...value }))
  const passwordError = draft?.password && !((draft.password.length >= 8 && draft.password.length <= 63 && /^[\x20-\x7e]+$/.test(draft.password)) || /^[0-9a-fA-F]{64}$/.test(draft.password))
  const needsPassword = draft && draft.encryption !== 'none' && !band.password_set && !draft.password
  const valid = draft && new TextEncoder().encode(draft.ssid).length >= 1 && new TextEncoder().encode(draft.ssid).length <= 32 && !passwordError && !needsPassword && Number.isInteger(draft.max_clients) && draft.max_clients >= 1 && draft.max_clients <= 32
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(draftOf(band))
  return <Card title={`访客 Wi-Fi · ${label}`} action={<Button size="sm" disabled={busy} onClick={() => { setDraft(draft ? null : draftOf(band)); setShow(false) }}>{draft ? `取消编辑访客 ${label}` : `编辑访客 ${label}`}</Button>}>
    <div className="space-y-3">
      <p className="text-meta text-ink2">{band.running ? 'ON · 正在广播' : 'OFF · 未广播'} · {band.clients} 台设备 · {remaining(band)}</p>
      {!band.radio_enabled && <InlineStatus kind="warn">{label} 总无线已关闭，需先在上方开启此频段，访客网络才会广播。</InlineStatus>}
      {!draft ? <div className="space-y-1 text-body text-ink2"><p className="break-words">SSID：{band.ssid}</p><p>安全：{modes[band.encryption] ?? band.encryption} · 广播：{band.broadcast ? '开启' : '隐藏'}</p><p>最大接入数：{band.max_clients} · PMF：{band.pmf ? '开启' : '关闭'} · 二维码：{band.qr ? '显示' : '隐藏'}</p></div> : <div className="space-y-3">
        <Toggle label={`访客 ${label} 开关`} checked={draft.enabled} disabled={busy} onChange={enabled => set({ enabled })} />
        <Field label={`访客 ${label} 名称`} hint="1–32 字节"><Input value={draft.ssid} disabled={busy} onChange={e => set({ ssid: e.target.value })} /></Field>
        <Field label={`访客 ${label} 安全模式`}><Select value={draft.encryption} disabled={busy} onChange={e => set({ encryption: e.target.value, ...(['sae', 'sae-mixed'].includes(e.target.value) ? { pmf: true } : {}) })}>{options.map(v => <option key={v} value={v}>{modes[v] ?? v}</option>)}</Select></Field>
        {draft.encryption !== 'none' && <><Field label={`访客 ${label} 密码`} hint="留空保留当前密码；8–63 位 ASCII 字符或 64 位十六进制" error={passwordError || needsPassword ? '请填写有效的访客密码' : undefined}><Input type={show ? 'text' : 'password'} autoComplete="new-password" value={draft.password ?? ''} disabled={busy} onChange={e => { const v = e.target.value; setDraft(d => { if (!d) return d; const next = { ...d }; if (v) next.password = v; else delete next.password; return next }) }} /></Field><Button disabled={busy} aria-pressed={show} onClick={() => setShow(!show)}>{show ? '隐藏密码' : '显示密码'}</Button></>}
        <Field label={`访客 ${label} 最大接入数`}><Input type="number" min={1} max={32} value={draft.max_clients} disabled={busy} onChange={e => set({ max_clients: Number(e.target.value) })} /></Field>
        <div className="flex flex-wrap gap-5"><Toggle label={`访客 ${label} SSID 广播`} checked={draft.broadcast} disabled={busy} onChange={broadcast => set({ broadcast })} /><Toggle label={`访客 ${label} PMF`} checked={draft.pmf} disabled={busy || ['sae', 'sae-mixed'].includes(draft.encryption)} onChange={pmf => set({ pmf })} /><Toggle label={`访客 ${label} 二维码显示`} checked={draft.qr} disabled={busy} onChange={qr => set({ qr })} /></div>
        <Button variant="primary" disabled={busy || !valid || !dirty} onClick={async () => { if (await save({ band: suffix, settings: draft }, `保存访客 ${label} 设置？`)) setDraft(null) }}>保存访客 {label}</Button>
      </div>}
    </div>
  </Card>
}
export default function GuestWifi({ blocked = false, acquire, release }: { blocked?: boolean; acquire?: () => boolean; release?: () => void }) {
  const { data, error, refresh, mutate } = usePoll('guest-wifi', read, 15000)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState('')
  const [hours, setHours] = useState<number | null>(null)
  const lock = useRef(false)
  const disabled = busy || blocked
  async function save(body: Record<string, unknown>, title: string) {
    if (lock.current || blocked || (acquire && !acquire())) return false
    lock.current = true; setBusy(true); setFailure(''); setMessage('')
    try {
      if (!await confirm({ title, body: '访客连接可能短暂断开；无线重载也可能短暂影响主网络。', confirmLabel: '应用', kind: 'connection', recovery: '重新连接原 Wi-Fi，刷新后核对实际状态。' })) return false
      const result = await req('POST', '/cgi-bin/guest-wifi', body, undefined, 30000, window.location.origin) as unknown as Snapshot
      mutate(result); setMessage('设置已保存并回读。请以广播状态和设备连接结果确认生效。'); return true
    } catch (e) { setFailure(e instanceof Error ? e.message : '保存失败'); return false }
    finally { lock.current = false; setBusy(false); release?.() }
  }
  if (!data) return <Card title="访客 Wi-Fi"><InlineStatus kind={error ? 'error' : 'info'} action={{ label: '重试', onClick: refresh }}>{error ? '无法读取访客设置，请检查访客管理接口。' : '正在读取访客网络…'}</InlineStatus></Card>
  const enabled = data.bands['2g'].enabled || data.bands['5g'].enabled
  const selectedHours = hours ?? data.bands[data.bands['2g'].running ? '2g' : '5g'].duration_hours
  return <section aria-label="访客 Wi-Fi 设置" className="space-y-3">
    <Card title="访客 Wi-Fi"><div className="space-y-4">
      <Toggle label="访客 Wi-Fi 总开关" checked={enabled} disabled={disabled} onChange={on => void save({ enabled: on }, `${on ? '开启' : '关闭'}访客 Wi-Fi？`)} />
      <div className="flex flex-wrap items-end gap-3"><Field label="访客开放时长" hint="两频段共用；应用后由原厂固件负责到期关闭"><Select value={selectedHours} disabled={disabled} onChange={e => setHours(Number(e.target.value))}>{data.duration_options.map(v => <option value={v} key={v}>{v === 0 ? '不限时' : v === 24 ? '1 天' : `${v} 小时`}</option>)}</Select></Field><Button disabled={disabled || hours == null} onClick={async () => { if (await save({ duration_hours: selectedHours }, '应用访客开放时长？')) setHours(null) }}>应用开放时长</Button></div>
      {data.lan_access != null && <Toggle label="允许访客访问局域网" checked={data.lan_access} disabled={disabled} onChange={lan_access => void save({ lan_access }, `${lan_access ? '允许' : '禁止'}访客访问局域网？`)} />}
      {data.bands['2g'].duration_hours !== data.bands['5g'].duration_hours && <p className="text-meta text-ink3">当前两频段开放时长不同，分别显示在下方；应用时长后才会同步两频段。</p>}
      {data.sync_enabled && <p className="text-meta text-ink3">原厂双频合一已开启：从 2.4 GHz 卡片保存设置，会同步到 5 GHz。两频段广播状态分别显示。</p>}
      <p className="text-meta text-ink3">修改访客设置不会自动开启已关闭的总无线。剩余时间每 15 秒从设备刷新。</p>
      {message && <InlineStatus kind="ok">{message}</InlineStatus>}{(failure || error) && <InlineStatus kind="error" action={{ label: '刷新', onClick: refresh }}>{failure || '状态刷新失败，当前显示上次读取值。'}</InlineStatus>}
    </div></Card>
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{(['2g', '5g'] as const).map(band => <BandForm key={band} suffix={band} band={data.bands[band]} label={band === '2g' ? '2.4 GHz' : '5 GHz'} busy={disabled || (data.sync_enabled === true && band === '5g')} options={data.security_options} save={save} />)}</div>
  </section>
}
