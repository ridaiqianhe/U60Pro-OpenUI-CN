import { useEffect, useState } from 'react'
import { req } from '../../data/client'
import { Button, Field, Input, Select, Toggle } from '../../ui/controls'
import { Card } from '../../ui/primitives'
type History = { event_id: string; time: number; ok: boolean; status: number }
type State = { cleanup_enabled?: boolean; cleaned_total?: number; cleanup_error?: string; format?: string; form_fields?: string; enabled?: boolean; url?: string; token_configured?: boolean; sender_filter?: string; keyword_filter?: string; pending?: number; history?: History[] }
export default function SmsForwardTab() {
 const [state,setState]=useState<State>({})
 const [url,setUrl]=useState('');const [token,setToken]=useState('')
 const [format,setFormat]=useState('json');const [fields,setFields]=useState('key=xx\nmsg={{content}}')
 const [sender,setSender]=useState('');const [keyword,setKeyword]=useState('')
 const [busy,setBusy]=useState(false);const [loaded,setLoaded]=useState(false)
 const [error,setError]=useState('');const [message,setMessage]=useState('')
 async function refresh() { const d=await req('GET','/cgi-bin/sms-forward',undefined,undefined,10000,'');setState(d);return d as State }
 useEffect(()=>{let active=true;void refresh().then(d=>{if(active){setUrl(d.url??'');setFormat(d.format??'json');setFields(d.form_fields||'key=xx\nmsg={{content}}');setSender(d.sender_filter??'');setKeyword(d.keyword_filter??'');setLoaded(true)}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[])
 async function act(action:string,extra:Record<string,unknown>={}) {
  setBusy(true);setError('');setMessage('')
  try {
   const d=await req('POST','/cgi-bin/sms-forward',{action,...extra},undefined,30000,'')
   if(action==='test'){if(d.test_ok!==true)throw new Error(`测试发送失败：HTTP ${d.http_status??0}`);setMessage('测试消息已送达 Webhook。')}
   else {setState(d);setMessage(action==='save'?'配置已保存。':action==='cleanup'?(extra.enabled?'50 条自动清理已开启。':'自动清理已关闭。'):extra.enabled?'已开启，仅转发此后收到的新短信。':'转发已关闭。');if(action==='save')setToken('')}
   await refresh()
  } catch(e){setError(e instanceof Error?e.message:'操作失败')}finally{setBusy(false)}
 }
 return <div className="space-y-4">
  <Card title="短信自动转发">
   <div className="flex items-center justify-between gap-4"><div><p className="font-medium">{state.enabled?'ON · 自动转发新短信':'OFF · 暂未转发'}</p><p className="mt-1 text-meta text-ink3">每 15 秒检查一次；设备重启后保持。不会补发开启前的历史短信。</p></div><Toggle label="短信转发总开关" checked={state.enabled===true} disabled={!loaded||busy||!state.url} onChange={enabled=>void act('enable',{enabled})}/></div>
   <p className="mt-3 text-meta text-ink2">等待重试：{state.pending??0} 条。Webhook 超时可能产生重复投递，接收端可用 event_id 去重。</p>
  </Card>
  {error&&<p role="alert" className="text-body text-danger">{error}</p>}{message&&<p role="status" className="text-body text-ok">{message}</p>}
  <Card title="短信自动清理">
   <div className="flex items-center justify-between gap-4"><div><p className="font-medium">达到 50 条时逐条删除最旧短信</p><p className="mt-1 text-meta text-ink3">每 15 秒检查，保留最新 49 条；待转发短信和草稿不删除。此开关独立于短信转发，重启后保留。</p></div><Toggle label="50 条短信自动清理" checked={state.cleanup_enabled===true} disabled={!loaded||busy} onChange={enabled=>void act('cleanup',{enabled})}/></div>
   <p className="mt-3 text-meta text-ink2">已自动清理：{state.cleaned_total??0} 条。</p>
   {state.cleanup_error&&<p className="mt-2 text-meta text-warn">{state.cleanup_error}</p>}
  </Card>
  <Card title="Webhook 设置">
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void act('save',{url:url.trim(),...(token?{token}:{}),sender_filter:sender,keyword_filter:keyword,format,form_fields:fields})}}>
    <Field label="Webhook URL"><Input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/webhook" autoComplete="off" disabled={busy||state.enabled}/></Field>
    <Field label="POST 格式"><Select value={format} onChange={e=>setFormat(e.target.value)} disabled={busy}><option value="json">JSON</option><option value="form">表单（x-www-form-urlencoded）</option></Select></Field>
    {format==='form'&&<label className="block text-meta text-ink2">表单字段（每行一项 key=value）<textarea value={fields} onChange={e=>setFields(e.target.value)} disabled={busy} spellCheck={false} className="mt-2 min-h-32 w-full rounded-ctl border border-line/15 bg-surface p-3 font-mono text-sm text-ink"/><span className="mt-1 block text-meta text-ink3">{'支持 {{content}} 正文、{{sender}} 号码、{{received_at}} 时间、{{event_id}} 唯一编号、{{device}} 设备名。自动编码中文、换行及 & 等字符。'}</span></label>}
    <Field label="Bearer Token（可选）" hint={state.token_configured?'已保存鉴权；留空保留。':'需要鉴权时填写，发送为 Authorization: Bearer …'}><Input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="new-password" disabled={busy}/></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="发送号码包含（可选）"><Input value={sender} onChange={e=>setSender(e.target.value)} placeholder="留空匹配全部" disabled={busy}/></Field><Field label="短信内容包含（可选）"><Input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="留空匹配全部" disabled={busy}/></Field></div>
    <p className="text-meta text-ink3">两项过滤条件同时满足才发送。启用后，匹配短信的号码、正文和时间会发送到该地址。</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={busy||!url.trim()}>保存配置</Button><Button type="button" disabled={busy||!state.url} onClick={()=>void act('test')}>发送测试消息</Button></div>
   </form>
  </Card>
  <Card title="最近发送记录" action={<Button size="sm" disabled={busy} onClick={()=>void refresh().catch(e=>setError(String(e)))}>刷新</Button>}>
   {(state.history??[]).length===0?<p className="text-body text-ink3">暂无记录。测试消息不包含真实短信。</p>:<div className="space-y-2">{state.history?.map((item,i)=><p key={`${item.event_id}-${i}`} className="font-mono text-meta"><span className={item.ok?'text-ok':'text-danger'}>{item.ok?'成功':'待重试'}</span> · {new Date(item.time*1000).toLocaleString()} · HTTP {item.status} · {item.event_id.slice(0,8)}</p>)}</div>}
  </Card>
  <Card title="请求格式"><p className="mb-2 text-meta text-ink3">HTTP POST · 支持 JSON / 表单；UTF-8 中文正文，不修改设备短信的已读状态。</p><pre className="overflow-x-auto whitespace-pre-wrap font-mono text-meta">{JSON.stringify({event:'sms.received',event_id:'唯一标识',device:'U60 Pro',sender:'10086',content:'短信正文',received_at:'设备短信时间'},null,2)}</pre></Card>
 </div>
}
