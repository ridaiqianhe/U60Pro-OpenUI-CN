/** WMS comma timestamps use GSM quarter-hour offsets; agent semicolon timestamps use hours. */
export function parseSmsDate(raw?: string): Date | null {
 if (!raw) return null
 const match = /^(\d{2})([,;])(\d{2})[,;](\d{2})[,;](\d{2})[,;](\d{2})[,;](\d{2})(?:[,;]([+-]\d+(?:\.\d+)?))?$/.exec(raw)
 if (!match) {
  // Do not let the browser guess locale-dependent comma-separated dates.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
 }
 const year=2000+Number(match[1]), month=Number(match[3]), day=Number(match[4])
 const hour=Number(match[5]), minute=Number(match[6]), second=Number(match[7])
 const wall=Date.UTC(year,month-1,day,hour,minute,second)
 const check=new Date(wall)
 if (check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day || hour>23 || minute>59 || second>59) return null
 const offset=match[8]===undefined ? 8 : Number(match[8]) / (match[2]===',' || Math.abs(Number(match[8]))>14 ? 4 : 1)
 if (Math.abs(offset)>14) return null
 return new Date(wall-offset*3600000)
}
export function formatSmsDate(raw?: string): string {
 if (!raw) return ''
 const date=parseSmsDate(raw)
 if (!date) return raw
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date)
 const get=(type: string)=>parts.find(p=>p.type===type)?.value??''
 return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}
