import { useState } from 'react'
import { api } from '../../data/api'
import { usePoll } from '../../data/poll'
import { tempColorClass } from '../../format'
import type { BatteryBspInfo, BatteryDetail, ChargeControlState, CpuInfo, MemInfo, ThermalAll } from '../../types'
import { formatBytes } from '../../format'
import { Button, Field, Toggle } from '../../ui/controls'
import { Card, InlineStatus, Meter, Skeleton } from '../../ui/primitives'
import { LIMIT_MAX, LIMIT_MIN, LIMIT_STEP, limitToApply } from './chargeLimit'

interface MetricsData {
  thermal: ThermalAll | null
  battery: BatteryDetail | null
  batteryInfo: BatteryBspInfo | null
  cpu: CpuInfo | null
  mem: MemInfo | null
}

function ThermalBar({ label, value }: { label: string; value?: number | null }) {
  if (value == null) {
    return (
      <div className="flex justify-between text-meta">
        <span className="text-ink2">{label}</span>
        <span className="font-medium text-ink3">暂无数据</span>
      </div>
    )
  }
  const pct = Math.min((value / 100) * 100, 100)
  const tone = value > 80 ? 'bg-danger' : value > 60 ? 'bg-warn' : 'bg-ok'
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-meta">
        <span className="text-ink2">{label}</span>
        <span className={`tnum font-mono font-semibold ${tempColorClass(value)}`}>{value.toFixed(1)}°C</span>
      </div>
      <Meter pct={pct} tone={tone} />
    </div>
  )
}

// ── Charge control ────────────────────────────────────────────────────────────

function ChargeControlCard() {
  const { data: cc, error, status, refresh, mutate } = usePoll('charge-control', api.chargeControl, 10000)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Local edit of the limit. `null` = pristine: the slider shows the device's
  // value, and polls can never overwrite a value the user is still choosing.
  const [draft, setDraft] = useState<number | null>(null)

  async function apply(body: Partial<ChargeControlState>) {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      // The PUT returns the authoritative new state — publish it rather than
      // spending a second request re-reading what we were just handed.
      mutate(await api.chargeControlSet(body))
      if ('charge_limit' in body) setDraft(null)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Charge control failed')
    } finally {
      setBusy(false)
    }
  }

  if (!cc) {
    return (
      <Card title="充电控制">
        {status === 'error' ? (
          <InlineStatus kind="error" action={{ label: "重试", onClick: refresh }}>
            Charge control unavailable: {error}
          </InlineStatus>
        ) : (
          <Skeleton className="h-32" />
        )}
      </Card>
    )
  }

  const shown = draft ?? cc.charge_limit
  const pending = limitToApply(draft, cc.charge_limit)
  const limitEditable = cc.charge_limit_enabled && cc.battery_available

  return (
    <Card title="充电控制">
      <div className="space-y-3">
        {status === 'stale' && (
          <InlineStatus kind="stale" action={{ label: "重试", onClick: refresh }}>
            Showing the last reading; refresh failed: {error}
          </InlineStatus>
        )}
        {cc.last_error && <InlineStatus kind="error">{cc.last_error}</InlineStatus>}
        {failure && <InlineStatus kind="error">更改未应用： {failure}</InlineStatus>}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">电池状态</p>
            <p className="truncate text-meta text-ink2">
              {cc.battery_status ?? '暂无电池数据'}{cc.capacity != null ? ` · ${cc.capacity}%` : ''}
            </p>
          </div>
          <span className="text-meta text-ink2">
            {cc.charging_stopped == null ? '状态未知' : cc.charging_stopped ? '已暂停充电' : '允许充电'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line/8 pt-3">
          <div className="min-w-0">
            <p id="direct-power-mode" className="text-body font-medium text-ink">直流供电模式</p>
            <p id="direct-power-help" className="mt-0.5 text-meta text-ink2">
              对应原厂直流供电开关，开启后暂停电池充电。
              {cc.charging_stopped && !cc.manual_override && cc.charge_limit_enabled ? '当前由充电上限触发。' : ''}
              {cc.charging_stopped && cc.manual_override ? '当前为手动开启。' : ''}
            </p>
          </div>
          <Toggle
            checked={cc.charging_stopped === true}
            disabled={busy || status !== 'ready' || !cc.charger_available || cc.charging_stopped == null}
            onChange={(enabled) => apply({ charging_stopped: enabled })}
            labelledBy="direct-power-mode"
          />
        </div>

        <div className="border-t border-line/8 pt-3">
          <div className="flex items-center justify-between">
            <div>
              <p id="charge-limit-enforcer" className="text-body font-medium text-ink">充电上限</p>
              <p className="text-meta text-ink2">
                达到上限暂停，电量下降 {cc.hysteresis}% 后恢复
              </p>
            </div>
            <Toggle
              checked={cc.charge_limit_enabled}
              disabled={busy || !cc.battery_available}
              onChange={(v) => apply({ charge_limit_enabled: v })}
              labelledBy="charge-limit-enforcer"
            />
          </div>
          <div className="mt-3">
            <Field label="停止充电阈值" hint={pending != null ? `Not applied yet. The device limit is ${cc.charge_limit}%.` : undefined}>
              {(ids) => (
                <div className="flex items-center gap-3">
                  <input
                    id={ids.id}
                    aria-describedby={ids.describedBy}
                    type="range"
                    min={LIMIT_MIN}
                    max={LIMIT_MAX}
                    step={LIMIT_STEP}
                    value={shown}
                    aria-valuetext={`${shown}%`}
                    disabled={busy || !limitEditable}
                    onChange={(e) => setDraft(Number(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && draft != null) {
                        e.preventDefault()
                        setDraft(null)
                      }
                    }}
                    className="w-full accent-[rgb(var(--accent))] disabled:opacity-40"
                  />
                  <span className="tnum w-12 text-right font-mono text-body font-semibold text-ink" aria-hidden="true">
                    {shown}%
                  </span>
                </div>
              )}
            </Field>
            {draft != null && (
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  disabled={pending == null || !limitEditable}
                  onClick={() => pending != null && apply({ charge_limit: pending })}
                >
                  应用上限
                </Button>
              </div>
            )}
          </div>
        </div>

        <p className="text-caption leading-snug text-ink3">
          拔下充电器或关闭充电上限后，自动恢复充电。
        </p>
        {!cc.available && <p className="text-meta font-medium text-warn">Battery and charger hardware data are unavailable; controls are disabled.</p>}
      </div>
    </Card>
  )
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export default function MetricsTab() {
  const { data } = usePoll<MetricsData>(
    'metrics',
    async () => {
      const [t, b, bi, c, m] = await Promise.allSettled([
        api.thermalAll(),
        api.batteryDetail(),
        api.batteryInfoUbus(),
        api.cpu(),
        api.memory(),
      ])
      return {
        thermal: t.status === 'fulfilled' ? t.value : null,
        battery: b.status === 'fulfilled' ? b.value : null,
        batteryInfo: bi.status === 'fulfilled' ? bi.value : null,
        cpu: c.status === 'fulfilled' ? c.value : null,
        mem: m.status === 'fulfilled' ? m.value : null,
      }
    },
    5000,
  )

  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  const { thermal, battery, batteryInfo, cpu, mem } = data

  const cpuAvg =
    thermal?.available && thermal.cpu_0 != null
      ? [thermal.cpu_0, thermal.cpu_1, thermal.cpu_2, thermal.cpu_3]
          .filter((v): v is number => v != null)
          .reduce((a, b) => a + b, 0) /
        [thermal.cpu_0, thermal.cpu_1, thermal.cpu_2, thermal.cpu_3].filter((v) => v != null).length
      : undefined

  const batteryHealth =
    battery?.available && battery.charge_full_design_mah != null && battery.charge_full_design_mah > 0 && battery.charge_full_mah != null
      ? Math.round((battery.charge_full_mah / battery.charge_full_design_mah) * 100)
      : undefined

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card title="温度传感器">
        {thermal?.available ? (
          <div className="space-y-2.5">
            <ThermalBar label="CPU (avg)" value={cpuAvg} />
            <ThermalBar label="Modem (Q6 DSP)" value={thermal.modem} />
            <ThermalBar label="Modem SS" value={thermal.modem_ss0} />
            <ThermalBar label="PA (power amplifier)" value={thermal.pa} />
            <ThermalBar label="SDR (radio)" value={thermal.sdr} />
            <ThermalBar label="电池" value={thermal.battery} />
            <ThermalBar label="USB" value={thermal.usb} />
            <ThermalBar label="以太网 PHY" value={thermal.eth_phy} />
            <ThermalBar label="PMIC" value={thermal.pmic} />
            <ThermalBar label="Board (XO)" value={thermal.xo_therm} />
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-meta font-medium text-warn">暂无温度传感器数据。</p>
            {['CPU (avg)', 'Modem (Q6 DSP)', 'Modem SS', 'PA (power amplifier)', 'SDR (radio)', "电池", 'USB', "以太网 PHY", 'PMIC', 'Board (XO)'].map((label) => <ThermalBar key={label} label={label} />)}
          </div>
        )}
      </Card>

      <div className="space-y-3">
        <Card title="CPU 使用率">
          {cpu ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-body">
                  <span className="font-medium text-ink">整体</span>
                  <span className="tnum font-mono text-ink2">{cpu.overall.toFixed(1)}%</span>
                </div>
                <Meter pct={cpu.overall} />
              </div>
              {cpu.cores.length > 0 && (
                <div className="space-y-1.5 border-t border-line/8 pt-2.5">
                  {cpu.cores.map((pct, i) => (
                    <div key={i}>
                      <div className="mb-0.5 flex justify-between text-caption">
                        <span className="text-ink3">核心 {i}</span>
                        <span className="tnum font-mono text-ink2">{pct.toFixed(1)}%</span>
                      </div>
                      <Meter pct={pct} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-body text-ink3">暂无 CPU 数据</p>
          )}
        </Card>

        <Card title="内存">
          {mem ? (
            <div>
              <div className="mb-1 flex justify-between text-body">
                <span className="text-ink2">用量</span>
                <span className="tnum font-mono text-ink">
                  {formatBytes(mem.used_kb * 1024)} / {formatBytes(mem.total_kb * 1024)} ({mem.usage_pct.toFixed(0)}%)
                </span>
              </div>
              <Meter pct={mem.usage_pct} tone="bg-warn" />
            </div>
          ) : (
            <p className="text-body text-ink3">暂无内存数据</p>
          )}
        </Card>
      </div>

      <Card title="电池">
        {battery?.available ? (
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-body">
                <span className="tnum font-mono font-semibold text-ink">{battery.capacity != null ? `${battery.capacity}%` : "暂无数据"}</span>
                <span className="text-ink2">{battery.status ?? 'Unavailable'}</span>
              </div>
              {battery.capacity != null && <Meter pct={battery.capacity} tone={battery.capacity > 20 ? 'bg-ok' : 'bg-danger'} />}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
              <Info label="电源" value={formatMeasure(battery.power_mw, (value) => `${(value / 1000).toFixed(2)} W`)} />
              <Info label="电压" value={formatMeasure(battery.voltage_mv, (value) => `${(value / 1000).toFixed(3)} V`)} />
              <Info label="当前" value={formatMeasure(battery.current_ma, (value) => `${value} mA`)} />
              <Info label="充电类型" value={battery.charge_type ?? 'Unavailable'} />
              <Info label="温度" value={formatMeasure(battery.temperature_c, (value) => `${value.toFixed(1)}°C`)} cls={battery.temperature_c != null ? tempColorClass(battery.temperature_c) : 'text-ink3'} />
              <Info
                label={battery.status === 'Charging' ? 'Time to full' : 'Time to empty'}
                value={formatClock(battery.status === 'Charging' ? battery.time_to_full_secs : battery.time_to_empty_secs)}
              />
              <Info label="充电计数" value={formatMeasure(battery.charge_counter_mah, (value) => `${value.toLocaleString()} mAh`)} />
              <Info label="Cycles" value={formatMeasure(battery.cycle_count, String)} />
              <Info label="电量计" value={batteryInfo?.available && batteryInfo.using_hw_fg_chip != null ? (batteryInfo.using_hw_fg_chip ? "硬件" : 'Software') : "暂无数据"} />
              <Info label="电池连接" value={batteryInfo?.available && batteryInfo.online != null ? (batteryInfo.online ? 'Yes' : 'No') : "暂无数据"} />
            </div>
          </div>
        ) : (
          <p className="text-body font-medium text-warn">Battery hardware data are unavailable.</p>
        )}
      </Card>

      <div className="space-y-3">
        <Card title="电池健康">
          {battery?.available ? (
            <div className="space-y-1.5 text-body">
              <KV k="Health" v={battery.health ?? 'Unavailable'} />
              <KV k="Capacity" v={battery.charge_full_mah != null && battery.charge_full_design_mah != null ? `${battery.charge_full_mah.toLocaleString()} / ${battery.charge_full_design_mah.toLocaleString()} mAh` : "暂无数据"} />
              {batteryHealth != null && (
                <div className="flex justify-between">
                  <span className="text-ink2">容量保持率</span>
                  <span className={`tnum font-mono font-semibold ${batteryHealth > 80 ? 'text-ok' : 'text-warn'}`}>{batteryHealth}%</span>
                </div>
              )}
              <KV k="OCV" v={formatMeasure(battery.voltage_ocv_mv, (value) => `${(value / 1000).toFixed(3)} V`)} />
            </div>
          ) : (
          <p className="text-body font-medium text-warn">Battery health measures are unavailable.</p>
          )}
        </Card>

        <ChargeControlCard />
      </div>
    </div>
  )
}

function Info({ label, value, cls = 'text-ink' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className={`tnum font-mono truncate font-medium ${cls}`}>{value}</p>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink2">{k}</span>
      <span className="tnum font-mono font-medium text-ink">{v}</span>
    </div>
  )
}

function formatMeasure(value: number | null, format: (value: number) => string) {
  return value == null ? "暂无数据" : format(value)
}

function formatClock(secs: number | null) {
  if (secs == null || secs <= 0) return "暂无数据"
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
