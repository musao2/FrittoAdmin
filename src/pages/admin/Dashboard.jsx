import { useState, useEffect, useCallback } from 'react'
import {
  LuUsers,
  LuUserCheck,
  LuClock,
  LuTrendingUp,
  LuDollarSign,
  LuTriangleAlert,
  LuActivity,
  LuRefreshCw,
  LuWallet,
  LuClipboardList,
  LuChevronRight,
} from 'react-icons/lu'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area
} from 'recharts'
import {
  employeeFunctions, attendanceFunctions, formatMoney, formatTashkentDateTime, supabase
} from '../../lib/supabase'
import { useBranch } from '../../context/BranchContext'
import { Link } from 'react-router-dom'

const UZ_MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']
const UZ_MONTHS_SHORT = ['Yan','Fev','Mar','Apr','May','Iyun','Iyul','Avg','Sen','Okt','Noy','Dek']
const UZ_WEEKDAYS = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba']
const pad2 = (n) => String(n).padStart(2, '0')

// Supabase bir so'rovda ko'pi bilan 1000 qator beradi — hammasini sahifalab olamiz
async function fetchAllRows(build, pageSize = 1000) {
  const rows = []
  for (let fromIdx = 0; ; fromIdx += pageSize) {
    const { data, error } = await build().range(fromIdx, fromIdx + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2 shadow-xl">
      <p className="text-xs font-semibold text-slate-500 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-bold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && p.value > 1000
            ? formatMoney(p.value)
            : p.value}
        </p>
      ))}
    </div>
  )
}

export default function AdminDashboard() {
  const { matchEmployee } = useBranch()
  const [stats, setStats]                 = useState(null)
  const [todaySessions, setTodaySessions] = useState([])
  const [recentSessions, setRecentSessions] = useState([])
  const [monthlyData, setMonthlyData]     = useState([])
  const [loading, setLoading]             = useState(true)
  const [refreshing, setRefreshing]       = useState(false)
  const [lastUpdated, setLastUpdated]     = useState(null)

  const now = new Date()
  const thisYear  = now.getFullYear()
  const thisMonth = now.getMonth() + 1

  const load = useCallback(async () => {
    try {
      const [empStats, todaySess, recentSess] = await Promise.all([
        employeeFunctions.getDashboardStats(matchEmployee),
        attendanceFunctions.getTodayStats(),
        attendanceFunctions.getAll({ limit: 60 }),
      ])

      // Tanlangan filial bo'yicha filtrlash
      const ids = new Set(empStats.employeeIds)
      setStats(empStats)
      setTodaySessions(todaySess.filter(s => ids.has(s.employee_id)))
      setRecentSessions(recentSess.filter(s => matchEmployee(s.employees)))

      // Oxirgi 6 oy: ish haqi (davomatdan + belgilangan oyliklar), avanslar, ishlagan xodimlar
      const months = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(thisYear, thisMonth - 1 - i, 1)
        months.push({ key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, year: d.getFullYear(), month: d.getMonth() + 1, name: UZ_MONTHS_SHORT[d.getMonth()] })
      }
      const from = `${months[0].key}-01T00:00:00+05:00`
      const monthOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' }).slice(0, 7)

      const [sess, advs, rates] = await Promise.all([
        fetchAllRows(() => supabase.from('attendance_sessions')
          .select('employee_id, check_in_at, earned_amount')
          .in('status', ['closed', 'corrected'])
          .gte('check_in_at', from)
          .order('check_in_at')),
        fetchAllRows(() => supabase.from('advances')
          .select('employee_id, amount, created_at')
          .eq('status', 'active')
          .gte('created_at', from)
          .order('created_at')),
        supabase.from('salary_rates').select('*').then(r => r.data || []),
      ])

      const mData = months.map(m => {
        const mySess = sess.filter(x => ids.has(x.employee_id) && monthOf(x.check_in_at) === m.key)
        const myAdv  = advs.filter(x => ids.has(x.employee_id) && monthOf(x.created_at) === m.key)
        // Belgilangan oylikdagi xodimlar: shu oyda amalda bo'lgan oylik summasi
        const first = `${m.key}-01`
        const last  = `${m.key}-${pad2(new Date(m.year, m.month, 0).getDate())}`
        const monthly = rates.filter(r => r.salary_type === 'monthly' && ids.has(r.employee_id)
          && r.effective_from <= last && (!r.effective_to || r.effective_to > first))
        const monthlyByEmp = {}
        monthly.forEach(r => { monthlyByEmp[r.employee_id] = Number(r.monthly_salary) || 0 })
        const workers = new Set([...mySess.map(x => x.employee_id), ...Object.keys(monthlyByEmp)])
        return {
          name: m.name,
          earned: mySess.reduce((t, x) => t + (Number(x.earned_amount) || 0), 0)
            + Object.values(monthlyByEmp).reduce((t, v) => t + v, 0),
          advances: myAdv.reduce((t, x) => t + (Number(x.amount) || 0), 0),
          workers: workers.size,
        }
      })

      setMonthlyData(mData)
      setLastUpdated(new Date())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [thisYear, thisMonth, matchEmployee])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60000)
    return () => clearInterval(interval)
  }, [load])

  const refresh = () => {
    setRefreshing(true)
    load()
  }

  const currentlyWorking = todaySessions.filter(s => s.status === 'open').length
  const forgotCheckout = todaySessions.filter(s => s.status === 'open' && s.check_in_at && (new Date() - new Date(s.check_in_at)) > 14 * 3600 * 1000).length

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-xs font-medium">Yuklanmoqda...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Bosh sahifa</h1>
          <p className="page-subtitle capitalize">
            {UZ_WEEKDAYS[now.getDay()]}, {now.getDate()}-{UZ_MONTHS[now.getMonth()]} {now.getFullYear()}
          </p>
        </div>
        <button
          id="dashboard-refresh"
          onClick={refresh}
          disabled={refreshing}
          className="btn-secondary"
        >
          <LuRefreshCw size={14} className={refreshing ? 'animate-spin text-emerald-700' : 'text-slate-500'} />
          Yangilash
        </button>
      </div>

      {/* Stat cards - Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Jami xodimlar"
          value={stats?.total ?? '—'}
          icon={<LuUsers size={18} />}
          color="emerald"
          link="/admin/employees"
        />
        <StatCard
          label="Faol xodimlar"
          value={stats?.active ?? '—'}
          icon={<LuUserCheck size={18} />}
          color="green"
          link="/admin/employees"
        />
        <StatCard
          label="Test rejimida"
          value={stats?.onTrial ?? '—'}
          icon={<LuClipboardList size={18} />}
          color="amber"
          link="/admin/trials"
        />
        <StatCard
          label="Hozir smenada"
          value={currentlyWorking}
          icon={<LuActivity size={18} />}
          color="teal"
          sub={<span className="live-dot inline-block w-2 h-2 bg-emerald-500 rounded-full mr-1.5" />}
        />
      </div>

      {/* Stat cards - Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Bugun kelganlar"
          value={new Set(todaySessions.map(s => s.employee_id)).size}
          icon={<LuClock size={18} />}
          color="blue"
          link="/admin/attendance"
        />
        <StatCard
          label="Ketishni belgilamagan"
          value={forgotCheckout}
          icon={<LuTriangleAlert size={18} />}
          color="red"
        />
        <StatCard
          label="Bu oy avanslar"
          value={monthlyData[5]?.advances ? formatMoney(monthlyData[5].advances) : '—'}
          icon={<LuWallet size={18} />}
          color="purple"
          link="/admin/advances"
          small
        />
        <StatCard
          label="Bu oy ish haqi"
          value={monthlyData[5]?.earned ? formatMoney(monthlyData[5].earned) : '—'}
          icon={<LuDollarSign size={18} />}
          color="emerald"
          link="/admin/payroll"
          small
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Monthly earnings chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">
              <LuTrendingUp size={18} className="text-emerald-700" />
              Oylik ish haqi va avanslar statistikasi
            </h2>
          </div>
          {monthlyData.some(d => d.earned > 0 || d.advances > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="earnedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#FCA914" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#FCA914" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="advGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="earned"   name="Ish haqi" stroke="#FCA914" fill="url(#earnedGrad)" strokeWidth={2.5} dot={false} />
                <Area type="monotone" dataKey="advances" name="Avanslar" stroke="#8b5cf6" fill="url(#advGrad)"    strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
              Ma'lumot mavjud emas
            </div>
          )}
        </div>

        {/* Workers per month */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">
              <LuUsers size={18} className="text-emerald-700" />
              Oylik xodimlar hisob-kitobi
            </h2>
          </div>
          {monthlyData.some(d => d.workers > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="workers" name="Xodimlar soni" fill="#111111" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
              Ma'lumot mavjud emas
            </div>
          )}
        </div>
      </div>

      {/* Recent attendance */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">
            <LuClock size={18} className="text-emerald-700" />
            So'nggi davomat yozuvlari
          </h2>
          <Link
            to="/admin/attendance"
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
          >
            Barchasi <LuChevronRight size={14} />
          </Link>
        </div>

        {recentSessions.length === 0 ? (
          <p className="text-slate-400 text-sm py-8 text-center font-medium">Hozircha davomat yozuvlari yo'q</p>
        ) : (
          <div className="table-container">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-head">Xodim</th>
                  <th className="table-head">Keldi</th>
                  <th className="table-head">Ketdi</th>
                  <th className="table-head">Holat</th>
                  <th className="table-head">Hisoblangan summa</th>
                </tr>
              </thead>
              <tbody>
                {recentSessions.slice(0, 8).map(sess => (
                  <tr key={sess.id} className="table-row">
                    <td className="table-cell font-bold text-slate-800">
                      {sess.employees?.full_name || '—'}
                      <div className="text-xs font-normal text-slate-400">{sess.employees?.branch}</div>
                    </td>
                    <td className="table-cell font-medium">{formatTashkentDateTime(sess.check_in_at)}</td>
                    <td className="table-cell font-medium">
                      {sess.check_out_at ? formatTashkentDateTime(sess.check_out_at) : <span className="badge-yellow">Davom etmoqda</span>}
                    </td>
                    <td className="table-cell">
                      {sess.status === 'open'
                        ? <span className="badge-green">Ochiq</span>
                        : sess.status === 'closed'
                        ? <span className="badge-blue">Yopilgan</span>
                        : <span className="badge-gray">Tuzatilgan</span>
                      }
                    </td>
                    <td className="table-cell font-bold text-emerald-700">
                      {sess.earned_amount ? formatMoney(sess.earned_amount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lastUpdated && (
        <p className="text-xs font-medium text-slate-400 text-right">
          So'nggi yangilanish: {lastUpdated.toLocaleTimeString('uz-UZ')}
        </p>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, link, sub, small }) {
  const card = (
    <div className="stat-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500 truncate">{label}</p>
        <span className="text-slate-400 flex-shrink-0">{icon}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {sub}
        <p className={`font-semibold text-slate-900 leading-tight truncate ${small ? 'text-lg' : 'text-2xl'}`}>
          {value}
        </p>
      </div>
    </div>
  )

  return link ? <Link to={link} className="block min-w-0">{card}</Link> : card
}
