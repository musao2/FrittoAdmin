import { useEffect, useState, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { LuArrowLeft, LuChevronLeft, LuChevronRight, LuReceipt } from 'react-icons/lu'
import {
  supabase, employeeFunctions, attendanceFunctions, payrollFunctions,
  formatMoney,
  formatRate, isMonthlyRate,
} from '../../lib/supabase'
import SalaryBreakdown, { getRemaining } from '../../components/admin/SalaryBreakdown'
import PaymentMethod from '../../components/admin/PaymentMethod'

const TZ = 'Asia/Tashkent'
const MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr']
const WEEKDAYS = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba']
const DAY_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const pad = (n) => String(n).padStart(2, '0')
// Toshkent vaqti bo'yicha kun kaliti: "2026-10-14"
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const timeOf = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  : null
const dateOf = (iso) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return `${d.getDate()}-${MONTHS[d.getMonth()].toLowerCase()}`
}
const hoursText = (secs) => {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h} soat ${m} daq` : `${m} daq`
}

export default function AdminPayrollEmployee() {
  const { employeeId } = useParams()
  const [params, setParams] = useSearchParams()
  const now = new Date()
  const year  = Number(params.get('y')) || now.getFullYear()
  const month = Number(params.get('m')) || now.getMonth() + 1

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [data, setData]       = useState(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const lastDay = new Date(year, month, 0).getDate()
        const from = `${year}-${pad(month)}-01T00:00:00+05:00`
        const to   = `${year}-${pad(month)}-${pad(lastDay)}T23:59:59+05:00`

        const period = await payrollFunctions.getOrCreatePeriod(year, month)
        const [employee, sessions, items, advRes, adjRes] = await Promise.all([
          employeeFunctions.getById(employeeId),
          attendanceFunctions.getByEmployee(employeeId, { from, to }),
          payrollFunctions.getItems(period.id, employeeId),
          supabase.from('advances').select('*').eq('employee_id', employeeId)
            .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false }),
          supabase.from('payroll_adjustments').select('*').eq('employee_id', employeeId)
            .eq('period_id', period.id).order('created_at', { ascending: false }),
        ])
        if (!alive) return
        setData({
          employee,
          sessions,
          item: (items || []).find(i => i.employee_id === employeeId) || null,
          advances: advRes.data || [],
          adjustments: adjRes.data || [],
        })
      } catch (err) {
        if (alive) setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [employeeId, year, month])

  const goMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1)
    setParams({ y: d.getFullYear(), m: d.getMonth() + 1 })
  }

  // Oyning har bir kuni uchun qator
  const days = useMemo(() => {
    if (!data) return []
    const byDay = {}
    for (const s of data.sessions) {
      const k = dayKey(s.check_in_at)
      ;(byDay[k] ||= []).push(s)
    }
    const workDays = new Set((data.employee?.work_schedules || []).flatMap(s => s.work_days || []))
    const todayKey = dayKey(new Date().toISOString())
    const lastDay = new Date(year, month, 0).getDate()

    const rows = []
    for (let d = 1; d <= lastDay; d++) {
      const key = `${year}-${pad(month)}-${pad(d)}`
      const weekday = new Date(year, month - 1, d).getDay()
      const list = (byDay[key] || []).sort((a, b) => new Date(a.check_in_at) - new Date(b.check_in_at))
      const isOpen = list.some(s => s.status === 'open')
      const worked = list.reduce((sum, s) => sum + (s.worked_seconds || 0), 0)
      const earned = list.reduce((sum, s) => sum + (Number(s.earned_amount) || 0), 0)
      const late = list.find(s => s.lateness_type === 'late')

      let status
      if (list.length) status = isOpen ? 'open' : late ? 'late' : 'worked'
      else if (key > todayKey) status = 'future'
      else if (workDays.size && !workDays.has(DAY_KEYS[weekday])) status = 'off'
      else status = 'absent'

      rows.push({
        key, day: d, weekday, list, worked, earned, status,
        lateMinutes: late?.lateness_minutes || 0,
        firstIn: list[0]?.check_in_at,
        lastOut: isOpen ? null : list[list.length - 1]?.check_out_at,
      })
    }
    return rows
  }, [data, year, month])

  const totals = useMemo(() => ({
    days:   days.filter(d => d.list.length).length,
    absent: days.filter(d => d.status === 'absent').length,
    late:   days.filter(d => d.status === 'late').length,
    worked: days.reduce((s, d) => s + d.worked, 0),
    earned: days.reduce((s, d) => s + d.earned, 0),
  }), [days])

  const emp = data?.employee
  const item = data?.item
  const rate = emp?.salary_rates?.find(r => !r.effective_to)

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Orqaga */}
      <Link
        to={`/admin/payroll`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <LuArrowLeft size={16} /> Ish haqi ro'yxatiga qaytish
      </Link>

      {/* Sarlavha */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 text-lg font-semibold flex items-center justify-center flex-shrink-0">
            {(emp?.full_name || '?').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')}
          </div>
          <div className="min-w-0">
            <h1 className="page-title truncate">{emp?.full_name || (loading ? 'Yuklanmoqda...' : 'Xodim')}</h1>
            <p className="page-subtitle">
              {[emp?.position, emp?.branch, rate && formatRate(rate)].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {/* Oy tanlash */}
        <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg h-10">
          <button onClick={() => goMonth(-1)} className="px-2.5 h-full text-slate-500 hover:text-slate-900 cursor-pointer" aria-label="Oldingi oy">
            <LuChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-slate-900 w-32 text-center">{MONTHS[month - 1]} {year}</span>
          <button onClick={() => goMonth(1)} className="px-2.5 h-full text-slate-500 hover:text-slate-900 cursor-pointer" aria-label="Keyingi oy">
            <LuChevronRight size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />)}
          </div>
          <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      ) : data && (
        <>
          {/* Qisqacha */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Ishlagan kunlari" value={`${totals.days} kun`} hint={totals.absent ? `${totals.absent} kun kelmagan` : 'Kelmagan kuni yo\'q'} />
            <Stat label="Ishlagan soati" value={hoursText(totals.worked)} hint={totals.late ? `${totals.late} marta kechikkan` : 'Kechikmagan'} />
            <Stat
              label={isMonthlyRate(rate) ? 'Oylik maosh' : 'Ishlab topdi'}
              value={formatMoney(item?.total_earned ?? (isMonthlyRate(rate) ? rate.monthly_salary : totals.earned))}
              hint={isMonthlyRate(rate) ? 'Belgilangan, soat hisoblanmaydi' : undefined}
            />
            <Stat
              label="Qoldi (berish kerak)"
              value={formatMoney(Math.max(0, getRemaining(item)))}
              tone={item && getRemaining(item) <= 0 && item.net_payable > 0 ? 'text-green-700' : 'text-emerald-700'}
              hint={item && getRemaining(item) <= 0 && item.net_payable > 0 ? 'Hammasi berildi' : null}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
            {/* Har kuni */}
            <div className="table-container">
              <div className="px-4 py-3 border-b border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-900">Har kuni</p>
              </div>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-head">Kun</th>
                    <th className="table-head">Keldi</th>
                    <th className="table-head">Ketdi</th>
                    <th className="table-head text-right">Ishladi</th>
                    <th className="table-head text-right">Topdi</th>
                    <th className="table-head">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(d => {
                    const muted = !d.list.length
                    return (
                      <tr key={d.key} className={`table-row ${d.status === 'off' || d.status === 'future' ? 'bg-slate-50/60' : ''}`}>
                        <td className="table-cell">
                          <p className={muted ? 'text-slate-500' : 'text-slate-900 font-medium'}>{d.day}-{MONTHS[month - 1].toLowerCase()}</p>
                          <p className="text-xs text-slate-400">{WEEKDAYS[d.weekday]}</p>
                        </td>
                        <td className="table-cell tabular-nums">
                          {d.firstIn ? timeOf(d.firstIn) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="table-cell tabular-nums">
                          {d.lastOut ? timeOf(d.lastOut) : d.status === 'open' ? <span className="text-emerald-700">hali ishda</span> : <span className="text-slate-300">—</span>}
                          {d.list.length > 1 && <p className="text-xs text-slate-400">{d.list.length} marta kelib-ketgan</p>}
                        </td>
                        <td className="table-cell text-right tabular-nums">
                          {d.worked ? hoursText(d.worked) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="table-cell text-right tabular-nums font-medium">
                          {d.earned ? formatMoney(d.earned) : <span className="text-slate-300 font-normal">—</span>}
                        </td>
                        <td className="table-cell"><DayStatus d={d} /></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td className="table-cell font-semibold text-slate-900" colSpan={3}>Jami: {totals.days} kun</td>
                    <td className="table-cell text-right font-semibold text-slate-900 tabular-nums">{hoursText(totals.worked)}</td>
                    <td className="table-cell text-right font-semibold text-slate-900 tabular-nums">{formatMoney(totals.earned)}</td>
                    <td className="table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* O'ng ustun */}
            <div className="space-y-6">
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-900">Oylik hisobi</p>
                  <LuReceipt size={16} className="text-slate-400" />
                </div>
                {item
                  ? <SalaryBreakdown item={item} />
                  : <p className="text-sm text-slate-500">Bu oy uchun hali hisob qilinmagan. Ish haqi sahifasida «Qayta hisoblash» ni bosing.</p>}
              </div>

              <ListCard
                title="Avanslar"
                empty="Bu oy avans olmagan"
                rows={data.advances.map(a => ({
                  id: a.id,
                  left: dateOf(a.created_at),
                  sub: a.notes,
                  right: `−${formatMoney(a.amount)}`,
                  tone: a.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-red-600',
                }))}
              />

              <ListCard
                title="Bonus va jarimalar"
                empty="Bonus yoki jarima yo'q"
                rows={data.adjustments.map(a => ({
                  id: a.id,
                  left: a.reason,
                  sub: dateOf(a.created_at),
                  right: `${a.type === 'bonus' ? '+' : '−'}${formatMoney(a.amount)}`,
                  tone: a.type === 'bonus' ? 'text-green-700' : 'text-red-600',
                }))}
              />

              <ListCard
                title="Berilgan pullar"
                empty="Hali pul berilmagan"
                rows={(item?.payments || []).map(p => ({
                  id: p.id,
                  left: dateOf(p.payment_date),
                  sub: <PaymentMethod method={p.payment_method} />,
                  right: formatMoney(p.amount),
                  tone: 'text-green-700',
                }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone = 'text-slate-900' }) {
  return (
    <div className="stat-card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-xl font-semibold truncate ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-slate-400 truncate">{hint}</p>}
    </div>
  )
}

function DayStatus({ d }) {
  if (d.status === 'open')   return <span className="badge-blue">Hozir ishda</span>
  if (d.status === 'late')   return <span className="badge-yellow">{d.lateMinutes ? `${d.lateMinutes} daq kechikdi` : 'Kechikdi'}</span>
  if (d.status === 'worked') return <span className="badge-green">Ishladi</span>
  if (d.status === 'absent') return <span className="badge-red">Kelmadi</span>
  if (d.status === 'off')    return <span className="text-xs text-slate-400">Dam olish</span>
  return null
}

function ListCard({ title, empty, rows }) {
  return (
    <div className="card">
      <p className="text-sm font-semibold text-slate-900 mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map(r => (
            <div key={r.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-slate-900">{r.left}</p>
                {r.sub && <p className="text-xs text-slate-500 truncate">{r.sub}</p>}
              </div>
              <p className={`text-sm font-semibold whitespace-nowrap tabular-nums ${r.tone}`}>{r.right}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
