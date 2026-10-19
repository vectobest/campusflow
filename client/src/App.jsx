import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Analytics from './pages/Analytics'
import AuthPage from './pages/AuthPage'
import Contribute from './pages/Contribute'
import Home from './pages/Home'
import MyData from './pages/MyData'
import Privacy from './pages/Privacy'
import Research from './pages/Research'

function RequireAuth({ roles, children }) {
  const { loading, user } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (roles && !roles.includes(user.role)) return <p className="text-muted">You do not have access to this page.</p>
  return children
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link className="mt-4 inline-block font-medium text-brand" to="/">Back to home</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="contribute" element={<Contribute />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />
        <Route path="my-data" element={<RequireAuth><MyData /></RequireAuth>} />
        <Route path="analytics" element={<RequireAuth roles={['researcher', 'admin']}><Analytics /></RequireAuth>} />
        <Route path="research" element={<RequireAuth roles={['researcher', 'admin']}><Research /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
