import { useState } from 'react'
import { req } from '../../data/client'
import { usePoll } from '../../data/poll'
import { Button, Field, Input, Select, Toggle } from '../../ui/controls'
import { Card } from '../../ui/primitives'
import { confirm } from '../../ui/feedback'

type Channel = { id: string; name: string; enabled: boolean; url: string; format: string; form_fields: string; token_configured: boolean; sender_filter: string; keyword_filter: string; pending: number }
type History = { event_id: string; channel_id?: string; channel_name?: string; time: number; time_text?: string; ok: boolean; status: number; reason?: string }
type State = { cleanup_enabled?: boolean; cleaned_total?: number; cleanup_error?: string; enabled?: boolean; channels: Channel[]; pending?: number; history: History[] }
type Draft = Omit<Channel, 'enabled' | 'pending' | 'token_configured'> & { token: string; token_configured?: boolean }
const blank = (): Draft => ({ id: '', name: '', url: '', format: 'json', form_fields: 'key=xx\nmsg={{content}}', token: '', sender_filter: '', keyword_filter: '' })
const fetchState = async (): Promise<State> => {
 const d = await req('GET', '/cgi-bin/sms-forward', undefined, undefined, 10000, '')
 return { ...d, channels: Array.isArray(d.channels) ? d.channels : [], history: Array.isArray(d.history) ? d.history : [] } as State
}
export default function SmsForwardTab() {
 const { data, error: readError, refresh, mutate } = usePoll('sms-forward-multi', fetchState, 5000)
 const state = data ?? { channels: [], history: [] }
 const [draft, setDraft] = useState<Draft | null>(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [message, setMessage] = useState('')
 function update(patch: Partial<Draft>) { setDraft(d => d ? { ...d, ...patch } : d) }
 async function act(action: string, extra: Record<string, unknown> = {}) {
  if (busy) return
  setBusy(true); setError(''); setMessage('')
  try {
   const d = await req('POST', '/cgi-bin/sms-forward', { action, ...extra }, undefined, 30000, '')
   if (action === 'test') {
    if (d.test_ok !== true) throw new Error(`该通道未确认接收：HTTP ${d.http_status ?? 0}${d.reason === 'application_error' ? ' · 接口返回业务错误' : ''}`)
    setMessage('测试消息已被该通道接口确认接收。')
   } else {
    mutate({ ...d, channels: Array.isArray(d.channels) ? d.channels : [], history: Array.isArray(d.history) ? d.history : [] } as State)
    setMessage(action === 'save_channel' ? '通道已保存，默认停用，请按需开启。' : '设置已更新。')
    if (action === 'save_channel') setDraft(null)
   }
   refresh()
  } catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
  finally { setBusy(false) }
 }
 async function discard(ch: Channel) {
  if (await confirm({ title: `跳过 ${ch.name} 的待投递消息？`, body: `仅放弃此通道的 ${ch.pending} 条待投递任务，其他通道不受影响。不会删除短信，也不会自动补发。`, confirmLabel: '跳过此路重试', kind: 'danger' })) void act('discard_pending', { id: ch.id, confirm: true })
 }
 async function remove(ch: Channel) {
  if (await confirm({ title: `移除 ${ch.name}？`, body: '移除这条转发通道，不删除短信和历史发送记录。', confirmLabel: '移除', kind: 'danger' })) void act('remove_channel', { id: ch.id })
 }
 return <div className="space-y-4">
  <Card title="短信自动转发">
   <div className="flex items-center justify-between gap-4"><div><p className="font-medium">{state.enabled ? 'ON · 多路转发新短信' : 'OFF · 暂未转发'}</p><p className="mt-1 text-meta text-ink3">约每 5 秒检查；每路独立过滤、去重和重试。新增通道不补发历史短信。</p></div><Toggle label="短信转发总开关" checked={state.enabled === true} disabled={!data || busy || state.channels.length === 0} onChange={enabled => void act('enable', { enabled })}/></div>
   <p className="mt-3 text-meta text-ink2">等待投递：{state.pending ?? 0} 条短信。停用通道会暂停其重试，重新开启后继续。接收端可按 event_id 去重。</p>
  </Card>
  {(error || readError) && <p role="alert" className="text-body text-danger">{error || readError}</p>}
  {message && <p role="status" className="text-body text-ok">{message}</p>}
  <Card title="转发通道" action={<Button size="sm" disabled={busy || state.channels.length >= 12} onClick={() => setDraft(blank())}>添加通道</Button>}>
   <div className="space-y-4">{state.channels.map(ch => <div key={ch.id} className="border-b border-line/8 pb-4 last:border-0 last:pb-0">
    <div className="flex items-center justify-between gap-3"><div><p className="font-medium text-ink">{ch.name}</p><p className="mt-1 text-meta text-ink2">{ch.format === 'form' ? 'Form POST' : 'JSON POST'} · 待投递 {ch.pending} 条{ch.enabled ? ' · 已开启' : ' · 已停用'}</p></div><Toggle label={`${ch.name} 转发开关`} checked={ch.enabled} disabled={busy} onChange={enabled => void act('channel_enable', { id: ch.id, enabled })}/></div>
    <p className="mt-2 text-meta text-ink3">号码：{ch.sender_filter || '全部'} · 正文包含：{ch.keyword_filter || '不限'}</p>
    <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={busy || ch.enabled || ch.pending > 0} onClick={() => setDraft({ ...ch, token: '' })}>{ch.enabled ? '停用后编辑' : '编辑'}</Button><Button size="sm" disabled={busy} onClick={() => void act('test', { id: ch.id })}>测试此通道</Button><Button size="sm" variant="ghost" disabled={busy || ch.enabled || ch.pending > 0} onClick={() => void remove(ch)}>移除</Button>{ch.pending > 0 && <Button size="sm" variant="ghost" disabled={busy || ch.enabled} onClick={() => void discard(ch)}>跳过此路重试</Button>}</div>
    {ch.pending > 0 && <p className="mt-2 text-meta text-ink3">此通道有待投递消息，投递完成前不能更换地址或移除。</p>}
   </div>)}{state.channels.length === 0 && <p className="text-meta text-ink3">尚无转发通道，最多可添加 12 路。</p>}</div>
  </Card>
  {draft && <Card title={draft.id ? `编辑：${draft.name}` : '添加转发通道'}>
   <form className="space-y-3" onSubmit={e => { e.preventDefault(); const { token, token_configured: _stored, ...fields } = draft; void _stored; void act('save_channel', { ...fields, id: draft.id || undefined, url: draft.url.trim(), ...(token ? { token } : {}) }) }}>
    <Field label="通道名称"><Input value={draft.name} onChange={e => update({ name: e.target.value })} placeholder="例如 Bark / Webhook" maxLength={80} disabled={busy}/></Field>
    <Field label="Webhook URL"><Input type="url" value={draft.url} onChange={e => update({ url: e.target.value })} placeholder="https://example.com/webhook" autoComplete="off" disabled={busy}/></Field>
    <Field label="POST 格式"><Select value={draft.format} onChange={e => update({ format: e.target.value })} disabled={busy}><option value="json">JSON</option><option value="form">表单（x-www-form-urlencoded）</option></Select></Field>
    {draft.format === 'form' && <label className="block text-meta text-ink2">表单字段（每行一项 key=value）<textarea value={draft.form_fields} onChange={e => update({ form_fields: e.target.value })} disabled={busy} spellCheck={false} className="mt-2 min-h-32 w-full rounded-ctl border border-line/15 bg-surface p-3 font-mono text-sm text-ink"/><span className="mt-1 block text-meta text-ink3">{'支持 {{content}}、{{sender}}、{{received_at}}、{{event_id}}、{{device}}、{{event}}，自动编码中文、换行及 &。'}</span></label>}
    <Field label="Bearer Token（可选）" hint={draft.token_configured ? '已保存；留空保留。' : '需要鉴权时填写。'}><Input type="password" value={draft.token} onChange={e => update({ token: e.target.value })} autoComplete="new-password" disabled={busy}/></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="发送号码包含（可选）"><Input value={draft.sender_filter} onChange={e => update({ sender_filter: e.target.value })} placeholder="留空匹配全部" disabled={busy}/></Field><Field label="短信内容包含（可选）"><Input value={draft.keyword_filter} onChange={e => update({ keyword_filter: e.target.value })} placeholder="留空匹配全部" disabled={busy}/></Field></div>
    <p className="text-meta text-ink3">此通道的两项过滤条件需同时满足。开启后，匹配的新短信会发送到该地址。</p>
    <div className="flex gap-2"><Button type="submit" variant="primary" disabled={busy || !draft.url.trim() || !draft.name.trim()}>保存通道</Button><Button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</Button></div>
   </form>
  </Card>}
  <Card title="短信自动清理">
   <div className="flex items-center justify-between gap-4"><div><p className="font-medium">达到 50 条时逐条删除最旧短信</p><p className="mt-1 text-meta text-ink3">保留最新 49 条；任一路尚未投递成功的短信及草稿不删除。此开关独立于转发。</p></div><Toggle label="50 条短信自动清理" checked={state.cleanup_enabled === true} disabled={!data || busy} onChange={enabled => void act('cleanup', { enabled })}/></div>
   <p className="mt-3 text-meta text-ink2">已自动清理：{state.cleaned_total ?? 0} 条。</p>{state.cleanup_error && <p className="mt-2 text-meta text-warn">{state.cleanup_error}</p>}
  </Card>
  <Card title="最近发送记录" action={<Button size="sm" disabled={busy} onClick={refresh}>刷新</Button>}>
   {state.history.length === 0 ? <p className="text-body text-ink3">暂无记录。测试消息不包含真实短信。</p> : <div className="space-y-2">{state.history.map((item, i) => <p key={`${item.event_id}-${i}`} className="font-mono text-meta"><span className={item.ok ? 'text-ok' : 'text-danger'}>{item.ok ? '成功' : item.reason === 'cancelled' ? '已跳过' : '未送达'}</span> · {item.channel_name || '原通道'} · {item.time_text || new Date((item.time - 8 * 3600) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong' })} · HTTP {item.status}{item.reason === 'application_error' ? ' · 业务错误' : ''} · {item.event_id.slice(0, 8)}</p>)}</div>}
  </Card>
 </div>
}
