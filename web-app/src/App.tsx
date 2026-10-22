import { lazy, useEffect, useState } from 'react'
import { AUTH_EXPIRED_EVENT, clearToken, hasToken, req, setToken } from './data/client'
import { clearPollCache } from './data/poll'
import { HomeProvider } from './app/HomeContext'
import Login from './app/Login'
import Shell, { type Group } from './app/Shell'
import { useTheme } from './app/theme'
import { ConfirmHost, Toaster } from './ui/feedback'

const HomePage = lazy(() => import('./features/home/HomePage'))
const SignalGroup = lazy(() => import('./features/signal/SignalGroup'))
const NetworkGroup = lazy(() => import('./features/network/NetworkGroup'))
const ModemGroup = lazy(() => import('./features/modem/ModemGroup'))
const SystemGroup = lazy(() => import('./features/system/SystemGroup'))

const ClashPage = lazy(() => import('./features/clash/ClashPage'))

export default function App() {
  const [authed, setAuthed] = useState(hasToken())
  const [autoLoginAllowed, setAutoLoginAllowed] = useState(true)
  const [checking, setChecking] = useState(!hasToken())
  const [group, setGroup] = useState<Group>('home')
  const { theme, toggle } = useTheme()

  useEffect(() => {
    const onAuthExpired = () => {
      clearPollCache()
      setAuthed(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [])

  useEffect(() => {
    if (authed || !autoLoginAllowed) return
    let active = true
    void req('POST', '/cgi-bin/wg-login', {}, undefined, 6000, window.location.origin, false)
      .then(result => {
        if (active && typeof result.token === 'string') {
          setToken(result.token)
          setAuthed(true)
        }
      })
      .catch(() => { /* Other source networks keep the normal password login. */ })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [authed, autoLoginAllowed])

  if (!authed && checking && autoLoginAllowed) {
    return <div role="status" className="flex min-h-full items-center justify-center p-6 text-body text-ink2">正在检查登录状态…</div>
  }

  if (!authed) {
    return (
      <>
        <Login onAuthed={() => setAuthed(true)} />
        <Toaster />
      </>
    )
  }

  return (
    <>
      <HomeProvider fast={group === 'home' || group === 'signal'}>
        <Shell group={group} onNavigate={setGroup} theme={theme} onToggleTheme={toggle}>
          {group === 'home' && <HomePage onOpenClash={() => setGroup('clash')} />}
          {group === 'clash' && <ClashPage />}
          {group === 'signal' && <SignalGroup />}
          {group === 'network' && <NetworkGroup />}
          {group === 'modem' && <ModemGroup />}
          {group === 'system' && (
            <SystemGroup
              onLogout={() => {
                setAutoLoginAllowed(false)
                setChecking(false)
                clearToken()
                clearPollCache()
                setAuthed(false)
              }}
            />
          )}
        </Shell>
      </HomeProvider>
      <Toaster />
      <ConfirmHost />
    </>
  )
}
