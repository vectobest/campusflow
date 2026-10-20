import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, tokenStore } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, participant: null })

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setState({ loading: false, user: null, participant: null })
      return
    }
    try {
      const { data } = await api.me()
      setState({ loading: false, user: data.user, participant: data.participant })
    } catch (err) {
      if (err.kind === 'http' && err.status === 401) tokenStore.clear()
      setState({ loading: false, user: null, participant: null })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const establish = useCallback(({ token, user, participant }) => {
    tokenStore.set(token)
    setState({ loading: false, user, participant })
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      login: async (email, password) => establish((await api.login(email, password)).data),
      register: async (email, password) => establish((await api.register(email, password)).data),
      loginWithGoogle: async (credential) => establish((await api.googleSignIn(credential)).data),
      logout: () => {
        tokenStore.clear()
        setState({ loading: false, user: null, participant: null })
      },
      setParticipant: (participant) => setState((s) => ({ ...s, participant })),
    }),
    [state, refresh, establish],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
