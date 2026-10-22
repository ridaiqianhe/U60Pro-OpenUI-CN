import { useHome } from '../../app/HomeContext'
import { formatBytes, formatSpeed, formatUptime } from '../../format'
import { IBolt, IDownload, IUpload } from '../../icons'
import { Card, Chip, Meter, Row, SignalBars, Skeleton, Unavailable } from '../../ui/primitives'
import { MetricValue } from '../signal/MetricValue'
import { Tip } from '../signal/Tip'
import {
  METRIC_HELP,
  METRIC_LABEL,
  barsText,
  homeUsageRows,
  metricView,
  servingView,
} from '../signal/telemetryView'
import type { BatteryInfo } from '../../types'
import { zhStatus } from '../../ui/zhStatus'
import MihomoCard from './MihomoCard'

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 xl:h-44" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}

export default function HomePage({ onOpenClash }: { onOpenClash: () => void }) {
  const { data, error } = useHome()

  if (!data && !error) return <PageSkeleton />

  const signal = data?.signal ?? null
  const battery = data?.battery ?? null
  const speed = data?.speed ?? null
  const device = data?.device ?? null
  const wan = data?.wan ?? null
  const wan6 = data?.wan6 ?? null
  const cpu = data?.cpu ?? null
  const mem = data?.memory ?? null
  const usage = data?.usage ?? null

  // Mapper-validated serving carrier (SA -> NR PCC, LTE/NSA -> LTE anchor PCC); never a raw field.
  const serving = servingView(signal)
  const primary = serving.carrier
  const rsrp = metricView('rsrp', primary?.rsrp)
  const bars = barsText(signal?.signal_bars)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="hidden font-display text-2xl font-semibold tracking-[-0.015em] text-ink lg:block">概览</h1>
        <p className="lg:mt-0.5 text-body text-ink2">{zhStatus(signal?.carrier ?? '移动网络状态')}</p>
      </div>

      {error && !data && (
        <Card>
          <p className="text-body text-danger">{error}</p>
        </Card>
      )}

      {/* Readout band — the page's one graphite beat. Hairline grid via gap-px on a line-tinted ground. */}
      <section className="band overflow-hidden rounded-panel border border-line/10" aria-label="实时状态">
        <div className="grid grid-cols-6 gap-px bg-line/10 sm:grid-cols-8 xl:grid-cols-6">
          <div className="col-span-6 bg-band p-4 sm:col-span-8 xl:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label">RSRP</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    data-testid="home-rsrp"
                    data-level={rsrp.level}
                    className={`tnum font-mono text-5xl font-medium leading-none tracking-[-0.03em] ${rsrp.className}`}
                  >
                    {rsrp.text ?? <Unavailable label="暂无 RSRP 数据" />}
                  </span>
                  {rsrp.text !== null && <span className="font-display text-sm font-medium text-ink2">dBm</span>}
                </div>
                <p data-testid="home-rsrp-word" className={`mt-1.5 text-body font-semibold ${rsrp.className}`}>
                  {rsrp.text === null ? "暂无服务小区测量" : zhStatus(rsrp.word ?? '')}
                </p>
              </div>
              {bars === null ? (
                <p className="text-caption text-ink3">
                  信号格数 <Unavailable label="暂无信号格数" />
                </p>
              ) : (
                <SignalBars bars={signal?.signal_bars} large />
              )}
            </div>
            <div className="tnum mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-meta text-ink2">
              {serving.available && primary ? (
                <Chip tone={serving.rat?.startsWith('LTE') ? 'lte' : 'nr'}>{serving.label}</Chip>
              ) : (
                <span className="text-ink3">
                  服务小区 <Unavailable label="未报告服务载波" />
                </span>
              )}
              {serving.pci !== undefined && <span>PCI {serving.pci}</span>}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-line/10 pt-3 font-mono text-meta">
              {(['rsrq', 'sinr', 'rssi'] as const).map((m) => (
                <div key={m} className="min-w-0">
                  <dt className="label">
                    <Tip text={METRIC_HELP[m]} className="label">
                      {METRIC_LABEL[m]}
                    </Tip>
                  </dt>
                  <dd className="tnum mt-0.5 font-medium">
                    <MetricValue metric={m} value={primary?.[m]} word={false} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="col-span-6 bg-band p-4 sm:col-span-2 xl:col-span-1">
            <p className="label">Traffic</p>
            <div className="tnum mt-2 flex gap-x-6 font-mono font-medium text-ink sm:block sm:space-y-1.5">
              <p className="flex items-center gap-1.5 text-sm leading-none">
                <IDownload size={14} className="shrink-0 text-ok" />
                <span className="truncate" data-testid="home-download">DL {speed ? formatSpeed(speed.rx_bps) : '\u2014'}</span>
              </p>
              <p className="flex items-center gap-1.5 text-sm leading-none">
                <IUpload size={14} className="shrink-0 text-accent" />
                <span className="truncate" data-testid="home-upload">UL {speed ? formatSpeed(speed.tx_bps) : '\u2014'}</span>
              </p>
            </div>
            <p className="tnum mt-3 truncate font-mono text-caption text-ink3">
              Peak DL {speed && speed.max_rx_bps > 0 ? formatSpeed(speed.max_rx_bps) : '\u2014'}
            </p>
            <p className="tnum mt-1 font-mono text-caption text-ink3">Peak UL {speed && speed.max_tx_bps > 0 ? formatSpeed(speed.max_tx_bps) : '—'}</p>
          </div>

          <div className="col-span-6 bg-band p-4 sm:col-span-2 xl:col-span-1">
            <p className="label">QCI / 5QI</p>
            <p className="tnum mt-2 font-mono text-3xl font-medium text-ink" data-testid="home-qci">{data?.qci ?? '—'}</p>
            <div className="mt-3 space-y-1 border-t border-line/10 pt-3 font-mono text-meta">
              <p className="label">AMBR</p>
              <p data-testid="home-ambr-download">DL {data?.ambr_dl_mbps != null ? `${Math.round(data.ambr_dl_mbps)} Mbps` : '—'}</p>
              <p data-testid="home-ambr-upload">UL {data?.ambr_ul_mbps != null ? `${Math.round(data.ambr_ul_mbps)} Mbps` : '—'}</p>
            </div>
          </div>

          <div className="col-span-3 bg-band p-4 sm:col-span-2 xl:col-span-1">
            <p className="label">Connections</p>
            <p className="tnum mt-2 font-mono text-3xl font-medium leading-none text-ink" data-testid="home-connections">{data?.connections ?? '—'}</p>
            <p className="mt-3 text-meta text-ink2">WAN · TCP / UDP</p>
          </div>

          <div className="col-span-3 bg-band p-4 sm:col-span-2 xl:col-span-1">
            <p className="label flex items-center gap-1">
              Battery {battery?.charging && <IBolt size={12} className="text-warn" />}
            </p>
            <p className="tnum mt-2 font-mono text-2xl font-medium leading-none text-ink">
              {battery?.percent != null ? `${battery.percent}%` : '\u2014'}
            </p>
            <p className="mt-1.5 text-meta text-ink2">{batteryState(battery)}</p>
            <p className="tnum mt-3 truncate font-mono text-caption text-ink3">
              {battery?.voltage_mv ? `${(battery.voltage_mv / 1000).toFixed(2)} V` : '\u2014'}
              {battery?.temperature_c != null ? ` · ${battery.temperature_c.toFixed(1)}°C` : ''}
            </p>
          </div>
        </div>
      </section>

      <MihomoCard onOpen={onOpenClash} />

      {/* Radio details */}
      {signal && (signal.lte_carriers.length + signal.nr_carriers.length > 1) && (
        <Card title="载波信息">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="label mb-1.5 text-accent">LTE</p>
              {signal.lte_carriers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {signal.lte_carriers.map((c, i) => (
                    <Chip key={i} tone="lte">
                      {c.label} · {c.band}
                      {c.rsrp != null ? ` · ${c.rsrp} dBm` : ''}
                      {c.active === false ? ' · idle' : ''}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-body text-ink3">未报告 LTE 载波</p>
              )}
            </div>
            <div>
              <p className="label mb-1.5 text-nr">
                5G NR
              </p>
              {signal.nr_carriers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {signal.nr_carriers.map((c, i) => (
                    <Chip key={i} tone="nr">
                      {c.label} · {c.band}
                      {c.rsrp != null ? ` · ${c.rsrp} dBm` : ''}
                      {c.active === false ? ' · idle' : ''}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-body text-ink3">未报告 NR 载波</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Details row */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="连接信息">
          <Row label="运营商" value={zhStatus(signal?.carrier ?? '\u2014')} />
          <Row label="IPv4" value={wan?.ipv4 ?? '\u2014'} mono />
          <Row label="网关" value={wan?.gateway ?? '\u2014'} mono />
          <Row label="IPv6" value={wan6?.ipv6 ?? '\u2014'} mono wrap />
          {wan6?.prefix && <Row label="IPv6 前缀" value={wan6.prefix} mono wrap />}
          {wan?.dns && wan.dns.length > 0 && (
            <Row label="DNS" value={wan.dns.filter((d) => !d.includes(':')).join(', ') || '\u2014'} mono wrap />
          )}
        </Card>

        <Card title="设备信息">
          <Row label="型号" value={device?.model ?? '\u2014'} />
          <Row label="固件" value={device?.firmware ?? '\u2014'} />
          <Row label="运行时间" value={formatUptime(device?.uptime_secs)} />
          <div className="mt-2 space-y-2 border-t border-line/8 pt-2.5">
            <div>
              <div className="mb-1 flex justify-between text-caption">
                <span className="font-medium text-ink2">CPU</span>
                <span className="tnum font-mono text-ink2">{cpu ? `${cpu.overall.toFixed(0)}%` : '\u2014'}</span>
              </div>
              <Meter pct={cpu?.overall ?? 0} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-caption">
                <span className="font-medium text-ink2">内存</span>
                <span className="tnum font-mono text-ink2">{mem ? `${mem.usage_pct.toFixed(0)}%` : '\u2014'}</span>
              </div>
              <Meter pct={mem?.usage_pct ?? 0} tone="bg-warn" />
            </div>
          </div>
        </Card>

        <Card title="流量统计">
          {usage ? (
            <div className="space-y-2.5">
              {homeUsageRows(usage).map(({ label, rx, tx, total }) => (
                <div key={label} data-usage={label}>
                  <p className="label">{zhStatus(label)}</p>
                  <div className="tnum font-mono mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-body font-medium">
                    <span className="flex items-center gap-1 text-ok">
                      <IDownload size={12} /> <Bytes value={rx} />
                    </span>
                    <span className="flex items-center gap-1 text-accent">
                      <IUpload size={12} /> <Bytes value={tx} />
                    </span>
                    <span className="text-ink2">
                      <Bytes value={total} /> <span className="font-sans text-meta font-normal text-ink3">总计</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-body text-ink3">暂无数据</p>
          )}
        </Card>
      </div>
    </div>
  )
}

/** Measured bytes (0 stays "0 B"); unknown is an em dash with an Unavailable label. */
function Bytes({ value }: { value: number | null }) {
  return value === null ? <Unavailable /> : <>{formatBytes(value)}</>
}

function batteryState(battery: BatteryInfo | null | undefined): string {
  if (!battery) return '\u2014'
  if (battery.charging) return "充电中"
  if (battery.status === 'Full') return "已充满"
  return battery.plugged ? "已插电，未充电" : "电池供电"
}
