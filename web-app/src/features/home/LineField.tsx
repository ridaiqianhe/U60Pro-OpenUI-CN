import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const reducedQuery = '(prefers-reduced-motion: reduce)'
const subscribeReduced = (change: () => void) => {
  const media = window.matchMedia(reducedQuery)
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}
const reducedSnapshot = () => window.matchMedia(reducedQuery).matches
const widths = [0.38, 1.12, 2.28, 3.8]
const opacity = [0.15, 0.64, 0.93, 1]

// An original radio-wave study. It is decoration, never a signal measurement.
const field = Float32Array.from({ length: 60 * 30 }, (_, i) => {
  const x = (i % 60 - 29.5) / 30
  const y = (Math.floor(i / 60) - 14.5) / 15
  const radius = Math.hypot(x * 1.05, y)
  const rings = Math.exp(-(((radius - 0.27) / 0.05) ** 2)) + Math.exp(-(((radius - 0.55) / 0.06) ** 2)) + Math.exp(-(((radius - 0.83) / 0.065) ** 2))
  const mast = Math.abs(x) < 0.045 && y > 0.05 && y < 0.48 ? 1 : 0
  return Math.min(1, Math.max(mast, rings * (y < 0.1 ? 1 : 0.55)))
})

export default function LineField() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [enabled, setEnabled] = useState(false)
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => true)
  const moving = enabled && !reduced

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let visible = true
    let frame = 0
    let phase = 0
    let last = 0
    let painted = 0
    let dead = false
    let dprQuery: MediaQueryList | undefined

    const draw = (time = 0) => {
      if (dead) return
      const bounds = element.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const width = Math.max(1, Math.round(bounds.width * dpr))
      const height = Math.max(1, Math.round(bounds.height * dpr))
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, bounds.width, bounds.height)
      const unit = Math.min(bounds.width / 64, bounds.height / 32)
      const left = (bounds.width - unit * 59) / 2
      const top = (bounds.height - unit * 30) / 2
      const color = getComputedStyle(element).color
      context.lineCap = 'butt'
      context.strokeStyle = color
      for (let weight = 0; weight < 4; weight++) {
        context.beginPath()
        context.lineWidth = widths[weight] * unit / 5.25
        context.globalAlpha = opacity[weight]
        for (let i = 0; i < field.length; i++) {
          const column = i % 60
          const row = Math.floor(i / 60)
          const drift = moving ? Math.sin(column * 0.21 + row * 0.17 - time * 0.00017) * 0.045 : 0
          const value = field[i] + drift
          const bucket = value < 0.12 ? 0 : value < 0.42 ? 1 : value < 0.89 ? 2 : 3
          if (bucket !== weight) continue
          const x = left + column * unit
          const y = top + row * unit
          context.moveTo(x, y + 0.35)
          context.lineTo(x, y + unit - 0.35)
        }
        context.stroke()
      }
      context.globalAlpha = 1
      element.dataset.frames = String(++painted)
    }
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0 }
    const animate = (time: number) => {
      frame = 0
      if (dead || !moving || !visible || document.hidden) return
      // A capped 20 fps study, only while explicitly enabled and on screen.
      if (!last || time - last >= 50) { phase += last ? Math.min(time - last, 100) : 0; last = time; draw(phase) }
      frame = requestAnimationFrame(animate)
    }
    const reconcile = () => {
      stop()
      draw(phase)
      if (moving && visible && !document.hidden) frame = requestAnimationFrame(animate)
    }
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', watchDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      dprQuery.addEventListener('change', watchDpr)
      reconcile()
    }
    const resize = new ResizeObserver(reconcile)
    resize.observe(element)
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; reconcile() })
    intersection.observe(element)
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('resize', reconcile)
    // Theme changes need a single repaint even while motion is stopped.
    const theme = new MutationObserver(reconcile)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    watchDpr()
    return () => {
      dead = true; stop(); resize.disconnect(); intersection.disconnect(); theme.disconnect()
      dprQuery?.removeEventListener('change', watchDpr)
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('resize', reconcile)
    }
  }, [moving])

  return <div className="line-field-study" data-testid="line-field-study">
    <canvas ref={canvas} aria-hidden="true" className="line-field-canvas" data-mode={moving ? 'moving' : 'static'} />
    <div aria-hidden="true" className="line-field-cross line-field-cross-first" />
    <div aria-hidden="true" className="line-field-cross line-field-cross-last" />
    <div className="line-field-caption"><span>01 / RADIO FIELD</span><button type="button" aria-label="线场动效" aria-pressed={moving} title={reduced ? '系统已开启减少动态效果' : '控制装饰线场动效'} disabled={reduced} onClick={() => setEnabled(!enabled)}>{moving ? '暂停动效' : '开启动效'}<span aria-hidden="true">{moving ? 'Ⅱ' : '↗'}</span></button></div>
  </div>
}
