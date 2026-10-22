import { useEffect, useRef, useState } from 'react'
import { api } from '../../data/api'
import { API_BASE } from '../../data/client'
import { useResource, type PollResult } from '../../data/poll'
import { formatUptime } from '../../format'
import type { DeviceInfo, SimInfo } from '../../types'
import { ILogout, IPower, IRefresh, IRestart } from '../../icons'
import { useTheme, type ThemePref } from '../../app/theme'
import { Button, Segmented, Toggle } from '../../ui/controls'
import { confirm, toastError, toast } from '../../ui/feedback'
import { Card, Chip, InlineStatus, Loading, Row, Skeleton, Unavailable } from '../../ui/primitives'
import {
  USB_MODE_INFO,
  USB_RECHECK_MS,
  classifyUsbReadError,
  describeVerdict,
  evaluateSwitch,
  isTerminalVerdict,
  pendingFromResult,
  pendingFromUnknown,
  planUsbSwitch,
  scheduledMode,
  usbBootDefault,
  usbModeAvailability,
  usbModeLabel,
  type PendingSwitch,
  type SwitchVerdict,
  type UsbModeKey,
  type UsbProbe,
} from './usbView'

// ── Read failures ─────────────────────────────────────────────────────────────

/** Persistent inline note for a failed or stale read, with Retry. Renders nothing while healthy. */
function ReadNote({ res, what }: { res: Pick<PollResult<unknown>, 'status' | 'error' | 'refresh' | 'refreshing'>; what: string }) {
  if (res.status === 'error') {
    return (
      <InlineStatus kind="error" className="mb-3" action={{ label: "重试", onClick: res.refresh, loading: res.refreshing }}>
        {what} could not be read{res.error ? `: ${res.error}` : '.'}
      </InlineStatus>
    )
  }
  if (res.status === 'stale') {
    return (
      <InlineStatus kind="stale" className="mb-3" action={{ label: "重试", onClick: res.refresh, loading: res.refreshing }}>
        Showing the last reading of {what.toLowerCase()}; the latest refresh failed.
      </InlineStatus>
    )
  }
  return null
}

// ── USB mode + powerbank ──────────────────────────────────────────────────────

interface Attempt {
  id: number
  pending: PendingSwitch
  verdict: SwitchVerdict
}

async function readUsbProbe(): Promise<UsbProbe> {
  try {
    return { kind: 'status', status: await api.usbStatus() }
  } catch (e) {
    return classifyUsbReadError(e)
  }
}

function UsbSection() {
  const status = useResource('system-usb-status', api.usbStatus)
  const charger = useResource('system-usb-charger', api.chargerInfo)
  // Choice not yet applied. `null` follows the active mode.
  const [draft, setDraft] = useState<UsbModeKey | null>(null)
  const [busy, setBusy] = useState<'switch' | 'default' | 'powerbank' | null>(null)
  const lock = useRef(false)
  const [attempt, setAttempt] = useState<Attempt | null>(null)

  const verifying = attempt != null && !isTerminalVerdict(attempt.verdict)
  // Secondary one-shot owner for the bounded recheck. It never touches the mode mutation.
  const verify = useResource<UsbProbe>(
    `system-usb-verify:${attempt?.id ?? 0}`,
    async () => {
      const probe = await readUsbProbe()
      if (attempt) {
        const verdict = evaluateSwitch(attempt.pending, probe, Date.now())
        setAttempt((a) => (a && a.id === attempt.id ? { ...a, verdict } : a))
        if (probe.kind === 'status') status.mutate(probe.status)
      }
      return probe
    },
    verifying,
  )
  const { refresh: recheckNow } = verify
  const attemptId = attempt?.id

  useEffect(() => {
    if (!verifying) return
    const timer = setInterval(recheckNow, USB_RECHECK_MS)
    return () => clearInterval(timer)
  }, [verifying, attemptId, recheckNow])

  const current = status.data
  const ready = status.status === 'ready'
  const availability = usbModeAvailability(current)
  const selected: UsbModeKey | '' = draft ?? current?.active_mode ?? ''
  const plan = planUsbSwitch(current, selected)
  const controlsLocked = busy !== null || verifying
  const bootDefault = usbBootDefault(current)
  const ncm = availability.find((a) => a.mode === 'ncm')
  const selectedInfo = selected ? availability.find((a) => a.mode === selected) : undefined
  const unsupported = availability.filter((a) => !a.supported)

  async function applySwitch() {
    if (lock.current) return
    // Freeze exactly what is reviewed; nothing read after this point can change the request.
    const frozen = planUsbSwitch(status.data, selected)
    if (!frozen.ok) return
    const from = status.data?.active_mode ?? null
    lock.current = true
    setBusy('switch')
    try {
      if (!(await confirm(frozen.confirm))) return
      let result
      try {
        result = await api.usbMode(frozen.mode, frozen.options)
      } catch (e) {
        if (classifyUsbReadError(e).kind === 'unreachable') {
          // No reply: the switch may have started. Verify from status; never resend.
          setDraft(null)
          setAttempt({
            id: (attemptId ?? 0) + 1,
            pending: pendingFromUnknown(frozen.mode, from, Date.now()),
            verdict: { state: 'waiting' },
          })
          return
        }
        throw e
      }
      setDraft(null)
      setAttempt({
        id: (attemptId ?? 0) + 1,
        pending: pendingFromResult(result, frozen.mode, from, Date.now()),
        verdict: { state: 'waiting' },
      })
    } catch (e) {
      toastError(e, 'Failed to set USB mode')
    } finally {
      lock.current = false
      setBusy(null)
    }
  }

  /** Read-only: look again after a stop. Does not resend the switch. */
  function checkAgain() {
    if (!attempt) return
    setAttempt({
      id: attempt.id + 1,
      pending: { ...attempt.pending, startedAt: Date.now() },
      verdict: { state: 'waiting' },
    })
  }

  async function setNcmDefault(enabled: boolean) {
    if (lock.current) return
    lock.current = true
    setBusy('default')
    try {
      if (enabled) {
        const ok = await confirm({
          title: "每次开机后应用 NCM？",
          body: 'The agent will switch USB to experimental NCM after each boot, once the stock USB stack has settled.',
          confirmLabel: 'Enable',
          kind: 'connection',
          details: [
            { label: "操作", value: 'Persist NCM as the boot default' },
            { label: "当前开机默认值", value: usbModeLabel(bootDefault) },
          ],
          consequence: 'After each boot USB re-enumerates once, and a computer connected by USB loses its link briefly.',
          recovery: 'Turn this off here, or keep a Wi-Fi path open to the dashboard to do so.',
        })
        if (!ok) return
      }
      await api.usbDefaultMode(enabled ? 'ncm' : 'ecm', enabled ? { confirm_experimental: true } : undefined)
      status.refresh()
    } catch (e) {
      toastError(e, 'Failed to set USB boot default')
    } finally {
      lock.current = false
      setBusy(null)
    }
  }

  const rawPowerbank = charger.data ? Number(charger.data.otg_powerbank_state) : NaN
  const powerbank = rawPowerbank === 0 || rawPowerbank === 1 ? rawPowerbank === 1 : null

  async function togglePowerbank(on: boolean) {
    if (lock.current) return
    lock.current = true
    setBusy('powerbank')
    try {
      await api.usbPowerbank(on)
      charger.mutate({ ...(charger.data ?? {}), otg_powerbank_state: on ? 1 : 0 })
    } catch (e) {
      toastError(e, 'Failed to set powerbank')
    } finally {
      lock.current = false
      setBusy(null)
    }
  }

  const note =
    attempt && describeVerdict(attempt.pending, attempt.verdict, current?.active_mode ?? null)
  const scheduled = scheduledMode(attempt?.pending ?? null, attempt?.verdict ?? null)

  return (
    <Card title="USB 模式">
      <div className="space-y-3">
        {status.status === 'loading' && (
          <Loading label="正在读取 USB 状态">
            <Skeleton className="h-9 w-full" />
          </Loading>
        )}

        {status.status === 'error' && (
          <InlineStatus kind="error" action={{ label: "重试", onClick: status.refresh, loading: status.refreshing }}>
            USB status is unavailable{status.error ? `: ${status.error}` : '.'} USB mode changes are disabled until it can be read.
          </InlineStatus>
        )}
        {status.status === 'stale' && (
          <InlineStatus kind="stale" action={{ label: "重试", onClick: status.refresh, loading: status.refreshing }}>
            The latest USB status read failed. Mode changes are disabled until it succeeds.
          </InlineStatus>
        )}

        {current && (
          <>
            <div>
              <Row label="当前模式" value={current.active_mode ? usbModeLabel(current.active_mode) : <Unavailable />} mono />
              <Row label="Scheduled mode" value={scheduled ? `${usbModeLabel(scheduled)} (not yet verified)` : "无"} mono />
              <Row label="开机默认" value={bootDefault ? usbModeLabel(bootDefault) : <Unavailable />} mono />
            </div>
            {current.ncm_last_error && <p className="text-meta text-danger">Last NCM attempt: {current.ncm_last_error}</p>}

            <div className="space-y-2 border-t border-line/8 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<UsbModeKey | ''>
                  label="USB 模式"
                  options={availability.map((a) => ({ value: a.mode, label: a.label, disabled: !a.supported }))}
                  value={selected}
                  onChange={(m) => m && setDraft(m)}
                  disabled={controlsLocked || !ready}
                />
                <Button variant="primary" onClick={applySwitch} loading={busy === 'switch'} disabled={!ready || controlsLocked || !plan.ok}>
                  应用模式
                </Button>
              </div>
              {selectedInfo && (
                <p className="text-meta text-ink2">
                  {selectedInfo.experimental && (
                    <>
                      <Chip tone="warn">实验功能</Chip>{' '}
                    </>
                  )}
                  {USB_MODE_INFO[selectedInfo.mode].description}
                </p>
              )}
              {unsupported.map((a) => (
                <p key={a.mode} className="text-meta text-ink3">
                  {a.reason}
                </p>
              ))}
              <p className="text-meta text-ink3">
                Changing the mode re-enumerates USB. You will be asked to confirm before anything is sent.
              </p>
            </div>
          </>
        )}

        {attempt && note && (
          <div className="space-y-1">
            <InlineStatus
              kind={note.kind}
              action={
                attempt.verdict.state === 'error' || attempt.verdict.state === 'timeout'
                  ? { label: "重新检查", onClick: checkAgain }
                  : undefined
              }
            >
              {note.text}
            </InlineStatus>
            {attempt.pending.rollback && attempt.verdict.state !== 'verified' && (
              <p className="text-meta text-ink3">Agent note: {attempt.pending.rollback}</p>
            )}
          </div>
        )}

        {current && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/8 pt-3">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">开机后使用 NCM</p>
              <p className="text-meta text-ink2">Applies NCM after the stock USB stack settles. This is the boot default, not the active mode.</p>
            </div>
            <Toggle
              checked={bootDefault === 'ncm'}
              disabled={!ready || controlsLocked || (bootDefault !== 'ncm' && !ncm?.supported)}
              onChange={setNcmDefault}
              label="开机后使用 NCM"
            />
          </div>
        )}

        {charger.status === 'error' && (
          <InlineStatus kind="stale" action={{ label: "重试", onClick: charger.refresh, loading: charger.refreshing }}>
            Powerbank state could not be read.
          </InlineStatus>
        )}
        {powerbank !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/8 pt-3">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">反向供电 / OTG</p>
              <p className="text-meta text-ink2">将 USB-C 端口设为电源输出。</p>
            </div>
            <Toggle checked={powerbank} disabled={busy !== null} onChange={togglePowerbank} label="反向供电" />
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

export default function SettingsTab({ onLogout }: { onLogout: () => void }) {
  const { pref: themePref, setPref: setThemePref } = useTheme()
  const deviceRes = useResource<DeviceInfo>('system-device', api.device)
  const simRes = useResource<SimInfo>('system-sim', api.simInfo)
  const imeiRes = useResource<{ imei?: string }>('system-imei', () => api.simImei() as Promise<{ imei?: string }>)
  const device = deviceRes.data
  const sim = simRes.data
  const imei = imeiRes.data?.imei ?? ''
  const [busy, setBusy] = useState<string | null>(null)

  async function restartAgent() {
    setBusy('restart')
    try {
      await api.restartAgent()
      toast('Agent restarting — reloading in a few seconds')
      setTimeout(() => window.location.reload(), 5000)
    } catch (e) {
      toastError(e, 'Failed to restart agent')
      setBusy(null)
    }
  }

  async function runPowerAction(action: 'reboot' | 'shutdown') {
    const ok = await confirm({
      title: action === 'reboot' ? 'Reboot the device?' : 'Shut down the device?',
      body:
        action === 'reboot'
          ? 'All connections will drop for about 10-30 seconds.'
          : 'The device powers off. Use the physical power button to turn it back on.',
      confirmLabel: action === 'reboot' ? "重启设备" : "关机",
      kind: 'danger',
    })
    if (!ok) return
    setBusy(action)
    try {
      if (action === 'reboot') {
        await api.reboot()
        toast('Reboot command sent')
      } else {
        await api.shutdown()
        toast('Shutdown command sent')
      }
    } catch (e) {
      toastError(e, `Failed to ${action} device`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="设备信息">
          <ReadNote res={deviceRes} what="Device information" />
          <Row label="型号" value={device?.model ?? <Unavailable />} mono />
          <Row label="固件" value={device?.firmware ?? <Unavailable />} mono />
          {device?.hardware && <Row label="硬件" value={device.hardware} mono />}
          <Row label="Kernel" value={device?.kernel ?? <Unavailable />} mono />
          <Row label="运行时间" value={device ? formatUptime(device.uptime_secs) : <Unavailable />} />
          <Row label="加载" value={device?.load_avg?.map((v) => v.toFixed(2)).join(', ') ?? <Unavailable />} mono />
          <Row label="IMEI" value={imei || <Unavailable />} mono />
          {imeiRes.status === 'error' && <p className="mt-1 text-meta text-ink3">IMEI could not be read.</p>}
        </Card>

        <Card title="SIM 卡">
          <ReadNote res={simRes} what="SIM information" />
          <Row label="状态" value={sim?.state ?? <Unavailable />} />
          <Row label="ICCID" value={sim?.iccid ?? <Unavailable />} mono />
          <Row label="IMSI" value={sim?.imsi ?? <Unavailable />} mono />
          <Row label="MCC/MNC" value={sim?.mcc && sim?.mnc ? `${sim.mcc}/${sim.mnc}` : <Unavailable />} mono />
        </Card>
      </div>

      <UsbSection />

      <Card title="服务控制">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={restartAgent} loading={busy === 'restart'}>
            <IRefresh size={14} /> 重启管理后端
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
          >
            <IRestart size={14} /> 重新加载面板
          </Button>
          <Button variant="danger" onClick={() => runPowerAction('reboot')} loading={busy === 'reboot'}>
            <IRestart size={14} /> 重启设备
          </Button>
          <Button variant="danger" onClick={() => runPowerAction('shutdown')} loading={busy === 'shutdown'}>
            <IPower size={14} /> 关机
          </Button>
        </div>
        <p className="mt-2.5 text-meta text-ink3">
          重启管理后端会短暂中断管理连接；重启设备或关机会中断全部连接。
        </p>
      </Card>

      <Card title="外观">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-body text-ink2" aria-hidden="true">主题</span>
          <Segmented<ThemePref>
            label="主题"
            options={[
              { value: 'auto', label: "自动" },
              { value: 'light', label: "浅色" },
              { value: 'dark', label: "深色" },
            ]}
            value={themePref}
            onChange={setThemePref}
          />
        </div>
        <p className="mt-2 text-meta text-ink3">自动跟随当前设备的浅色或深色设置。</p>
      </Card>

      <Card title="连接信息">
        <Row label="API" value={API_BASE} mono />
        <Row label="控制面板" value={window.location.origin} mono />
        <div className="mt-3 border-t border-line/8 pt-3">
          <Button variant="ghost" onClick={onLogout}>
            <ILogout size={14} /> 退出登录
          </Button>
        </div>
      </Card>
    </div>
  )
}
