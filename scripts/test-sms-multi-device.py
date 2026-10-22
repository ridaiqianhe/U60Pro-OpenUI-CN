import http.server,threading,json,subprocess,time,pathlib,urllib.parse,collections,argparse,shlex
parser=argparse.ArgumentParser(description="Isolated on-device multi-route SMS forwarding integration checks; uses synthetic SMS only")
parser.add_argument("--ssh",required=True,help="SSH command ending in the device host alias")
args=parser.parse_args()
received=[];codes={'/a':200,'/b':503,'/c':200}
class Receiver(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  body=self.rfile.read(int(self.headers['Content-Length'])).decode()
  payload=json.loads(body) if self.headers['Content-Type']=='application/json' else {k:v[0] for k,v in urllib.parse.parse_qs(body,keep_blank_values=True).items()}
  received.append((self.path,payload));self.send_response(codes[self.path]);self.end_headers();self.wfile.write(b'{"code":200}')
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Receiver);threading.Thread(target=server.serve_forever,daemon=True).start()
ssh=shlex.split(args.ssh);base='/data/plugins/sms-multi-test'
forward=subprocess.Popen(ssh[:-1]+['-o','ExitOnForwardFailure=yes','-N','-R',f'18887:127.0.0.1:{server.server_port}',ssh[-1]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def run(cmd,data=None):return subprocess.check_output(ssh+[cmd],input=data,stderr=subprocess.DEVNULL)
def put(name,v):run('umask 077; cat > '+base+'/'+name,json.dumps(v,ensure_ascii=False).encode())
def state():return json.loads(run('cat '+base+'/state.json'))
def counts():return collections.Counter(x[0] for x in received)
def once():run('lua '+base+'/test.lua tick')
def retry():
 s=state()
 for v in s['pending'].values():
  for t in v['deliveries'].values():t['next_try']=0
 put('state.json',s)
try:
 for _ in range(30):
  if b'18887' in run('netstat -lnt | grep 18887 || true'):break
  time.sleep(.1)
 run('mkdir -p '+base+'; chmod 700 '+base)
 s=(pathlib.Path(__file__).resolve().parents[1]/'scripts/device/sms-forward/main.lua').read_text().replace("local base='/data/plugins/sms-forward'",f"local base='{base}'")
 a=s.index('local function messages()');b=s.index('\nlocal function fingerprint',a);s=s[:a]+"local function messages() return load(base..'/fixture.json',{}) end\n"+s[b:]
 a=s.index(" if not auth:match(");b=s.index(" then response('401 Unauthorized'",a)
 s=s[:a]+" if auth~='Bearer synthetic-token'"+s[b:]
 run('cat > '+base+'/test.lua',s.encode());run('lua '+base+'/test.lua selftest')
 def api(body):
  data=json.dumps(body).encode();r=run('env HTTP_AUTHORIZATION="Bearer synthetic-token" REQUEST_METHOD=POST CONTENT_LENGTH='+str(len(data))+' lua '+base+'/test.lua cgi',data)
  return json.loads(r.decode().split('\r\n\r\n',1)[1])

 channels=[{'id':'a','name':'A','enabled':True,'url':'http://127.0.0.1:18887/a','format':'json'},{'id':'b','name':'B','enabled':True,'url':'http://127.0.0.1:18887/b','format':'form','form_fields':'key=x&y\nmsg={{content}}\nevent_id={{event_id}}'},{'id':'c','name':'C','enabled':False,'url':'http://127.0.0.1:18887/c','format':'json'}]
 config={'enabled':True,'channels':channels};put('config.json',config)
 old={'id':1,'tag':0,'number':'106900001234','content':'65E753EF','date':'old'};new=dict(old,id=2,tag=1,date='new',content='4F60597D')
 put('fixture.json',[old]);once();assert not received
 put('fixture.json',[new,old]);once();assert counts()=={'/a':1,'/b':1};ss=state();item=next(iter(ss['pending'].values()));assert set(item['deliveries'])=={'b'};assert received[1][1]['msg']=='你好' and received[1][1]['key']=='x&y'
 once();assert counts()=={'/a':1,'/b':1}
 codes['/b']=200;retry();once();assert counts()=={'/a':1,'/b':2} and not state()['pending'];assert received[0][1]['event_id']==received[-1][1]['event_id']
 # Enable a third route: no backfill, then all three receive only the new event.
 channels[2]['enabled']=True;put('config.json',config);once();assert counts()=={'/a':1,'/b':2}
 put('fixture.json',[dict(new,id=3,date='third'),new,old]);once();assert counts()=={'/a':2,'/b':3,'/c':1}
 # A per-channel keyword filter affects only that route.
 channels[0]['keyword_filter']='not-matching';put('config.json',config);put('fixture.json',[dict(new,id=4,date='filtered')]);once();assert counts()=={'/a':2,'/b':4,'/c':2}
 # Old one-route failed queue migrates to legacy only, never copied into the new route.
 put('config.json',{'enabled':True,'channels':[dict(channels[1],id='legacy'),channels[2]]})
 put('fixture.json',[]);put('state.json',{'seen':{},'pending':{'old-event':{'payload':{'event_id':'old-event','content':'synthetic'},'attempts':0,'next_try':0}},'history':[],'cleaned_total':17});once();assert not state()['pending'] and state()['cleaned_total']==17 and counts()['/c']==2
 # Disabled route holds its own queue without re-sending the successful route.
 codes['/b']=503;put('config.json',config);put('state.json',{'seen':{},'pending':{},'history':[]});put('fixture.json',[dict(new,id=5,date='pause')]);once();before=counts().copy();channels[1]['enabled']=False;put('config.json',config);retry();once();assert counts()==before and state()['pending'];channels[1]['enabled']=True;codes['/b']=200;put('config.json',config);retry();once();assert counts()['/c']==before['/c'] and not state()['pending']
 # Explicit cancellation affects only this route and allows subsequent removal.
 codes['/b']=503;put('config.json',config);put('fixture.json',[dict(new,id=6,date='discard')]);once();channels[1]['enabled']=False;put('config.json',config)
 assert not api({'action':'remove_channel','id':'b'})['ok']
 assert not api({'action':'discard_pending','id':'b'})['ok']
 assert api({'action':'discard_pending','id':'b','confirm':True})['ok'];assert not state()['pending']
 assert api({'action':'remove_channel','id':'b'})['ok']
 # New routes are disabled by default; tokens never appear in status.
 saved=api({'action':'save_channel','name':'Extra','url':'http://127.0.0.1:18887/c','format':'json','token':'synthetic-secret'})
 assert saved['ok'];ch=saved['data']['channels'][-1];assert not ch['enabled'] and ch['token_configured'] and 'token' not in ch
 assert not api({'action':'save_channel','name':'Bad','url':'file:///tmp/private','format':'json'})['ok']
 print('PASS: multi-route fanout, independent retry, stable event ID, no duplicate successful route, third route without backfill, per-route filters, legacy pending migration, cleanup stats preserved, pause/resume queue')
finally:
 run('rm -rf '+base);forward.terminate();forward.wait(timeout=5);server.shutdown()
