import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LuLayoutDashboard,
  LuUsers,
  LuClipboardList,
  LuClock,
  LuDollarSign,
  LuCreditCard,
  LuWallet,
  LuSettings,
  LuLogOut,
  LuMenu,
  LuX,
  LuShieldCheck,
} from 'react-icons/lu'
import { FiBarChart2 } from 'react-icons/fi'
import NotificationBell from '../components/admin/NotificationBell'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'

// Menyu guruhlari — har bir bo'lim oddiy, tushunarli nom bilan
const NAV_GROUPS = [
  {
    title: null,
    items: [
      { path: '/admin', label: 'Bosh sahifa', icon: LuLayoutDashboard, end: true },
    ],
  },
  {
    title: 'Xodimlar',
    items: [
      { path: '/admin/employees',  label: 'Xodimlar ro\'yxati', icon: LuUsers, end: true },
      { path: '/admin/trials',     label: 'Sinov muddati',      icon: LuClipboardList },
      { path: '/admin/attendance', label: 'Davomat',            icon: LuClock },
      { path: '/admin/devices',    label: 'Kirish so\'rovlari', icon: LuShieldCheck, badge: 'devices' },
    ],
  },
  {
    title: 'Pul',
    items: [
      { path: '/admin/payroll',  label: 'Ish haqi',          icon: LuDollarSign },
      { path: '/admin/advances', label: 'Avanslar',          icon: LuWallet },
      { path: '/admin/payments', label: 'To\'lovlar tarixi', icon: LuCreditCard },
      { path: '/admin/reports',  label: 'Hisobotlar',        icon: FiBarChart2 },
    ],
  },
]

const ALL_ITEMS = [
  ...NAV_GROUPS.flatMap(g => g.items),
  { path: '/admin/settings', label: 'Sozlamalar' },
]

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [badges, setBadges] = useState({})

  // Kutilayotgan kirish so'rovlari soni (menyuda qizil raqam)
  useEffect(() => {
    let alive = true
    const load = async () => {
      const { count, error } = await supabase
        .from('employee_devices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (alive && !error) setBadges(b => ({ ...b, devices: count || 0 }))
    }
    load()
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [location.pathname])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const current = ALL_ITEMS.find(i =>
    i.end ? location.pathname === i.path : location.pathname.startsWith(i.path)
  )

  const linkClass = ({ isActive }) => (isActive ? 'sidebar-link-active' : 'sidebar-link')

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobil fon */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Yon menyu */}
      <aside className={`
        fixed top-0 left-0 h-screen w-60 bg-white border-r border-slate-200 z-50
        flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:sticky
      `}>
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-200">
          <Logo subtitle="Admin panel" />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-500 hover:text-slate-900 p-1"
            aria-label="Menyuni yopish"
          >
            <LuX size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.title && (
                <p className="px-3 pb-1 text-xs font-medium text-slate-400">{group.title}</p>
              )}
              {group.items.map(({ path, label, icon: Icon, end, badge }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={end}
                  onClick={() => setSidebarOpen(false)}
                  className={linkClass}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  <span className="truncate flex-1">{label}</span>
                  {badge && badges[badge] > 0 && (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-xs font-semibold flex items-center justify-center">
                      {badges[badge]}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3 space-y-1">
          <NavLink to="/admin/settings" onClick={() => setSidebarOpen(false)} className={linkClass}>
            <LuSettings size={18} className="flex-shrink-0" />
            <span>Sozlamalar</span>
          </NavLink>
          <button
            id="admin-logout"
            onClick={handleSignOut}
            className="sidebar-link w-full hover:text-red-600 hover:bg-red-50 cursor-pointer"
          >
            <LuLogOut size={18} className="flex-shrink-0" />
            <span>Chiqish</span>
          </button>
        </div>
      </aside>

      {/* Asosiy qism */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center gap-3 sticky top-0 z-30 print:hidden">
          <button
            id="sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-600 hover:text-slate-900 p-2 -ml-2"
            aria-label="Menyuni ochish"
          >
            <LuMenu size={20} />
          </button>

          <p className="text-base font-semibold text-slate-900 truncate">
            {current?.label || 'FRITTO'}
          </p>

          <div className="flex items-center gap-3 ml-auto">
            <NotificationBell />
            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {(profile?.full_name || profile?.email || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 leading-tight">
                <p className="text-sm font-medium text-slate-900 truncate max-w-40">
                  {profile?.full_name || profile?.email}
                </p>
                <p className="text-xs text-slate-500">Administrator</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
