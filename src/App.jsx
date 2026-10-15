import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

// Layouts
import AdminLayout  from './layouts/AdminLayout'

// Auth Pages
import LoginPage from './pages/LoginPage'
import WrongRole from './pages/WrongRole'

// Admin Pages
import AdminDashboard    from './pages/admin/Dashboard'
import AdminEmployees    from './pages/admin/Employees'
import AdminTrials       from './pages/admin/Trials'
import AdminAttendance   from './pages/admin/Attendance'
import AdminPayroll      from './pages/admin/Payroll'
import AdminPayrollEmployee from './pages/admin/PayrollEmployee'
import AdminAdvances     from './pages/admin/Advances'
import AdminPayments     from './pages/admin/Payments'
import AdminReports      from './pages/admin/Reports'
import AdminSettings     from './pages/admin/Settings'
import AdminDevices      from './pages/admin/Devices'

function AppRoutes() {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Yuklanmoqda...</p>
        </div>
      </div>
    )
  }

  if (!user || !profile) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Bu sayt faqat adminlar uchun
  if (profile.role !== 'admin') {
    return <WrongRole message="Bu sahifa faqat adminlar uchun. Xodimlar o'z saytiga kirishi kerak." />
  }

  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="employees"  element={<AdminEmployees />} />
        <Route path="trials"     element={<AdminTrials />} />
        <Route path="attendance" element={<AdminAttendance />} />
        <Route path="payroll"    element={<AdminPayroll />} />
        <Route path="payroll/:employeeId" element={<AdminPayrollEmployee />} />
        <Route path="advances"   element={<AdminAdvances />} />
        <Route path="payments"   element={<AdminPayments />} />
        <Route path="reports"    element={<AdminReports />} />
        <Route path="settings"   element={<AdminSettings />} />
        <Route path="devices"    element={<AdminDevices />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
