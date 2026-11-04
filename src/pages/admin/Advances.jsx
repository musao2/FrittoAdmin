import { useState, useEffect, useCallback } from 'react'
import {
  LuWallet, LuPlus, LuCircleX, LuRefreshCw, LuX, LuDownload, LuCircleAlert, LuTriangleAlert
} from "react-icons/lu"
import {
  advanceFunctions, employeeFunctions, formatMoney,
  formatTashkentDateTime, supabase
} from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import * as XLSX from 'xlsx'
import PaymentMethod from '../../components/admin/PaymentMethod'
import { useBranch } from '../../context/BranchContext'

const pad2 = (n) => String(n).padStart(2, '0')
const hoursText = (secs) => `${Math.floor(secs / 3600)} soat ${Math.floor((secs % 3600) / 60)} daq`

// Xodimning tanlangan oydagi holati: ishladi, topdi, avans, berildi, qoldi
async function loadMonthSummary(employeeId, monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const from = `${monthKey}-01T00:00:00+05:00`
  const to   = `${monthKey}-${pad2(last)}T23:59:59+05:00`
  const num = (v) => Number(v) || 0

  const [sess, rates, adv, period] = await Promise.all([
    supabase.from('attendance_sessions').select('check_in_at, worked_seconds, earned_amount')
      .eq('employee_id', employeeId).in('status', ['closed', 'corrected']).gte('check_in_at', from).lte('check_in_at', to),
    supabase.from('salary_rates').select('*').eq('employee_id', employeeId).order('effective_from', { ascending: false }),
    supabase.from('advances').select('amount').eq('employee_id', employeeId).eq('status', 'active')
      .gte('created_at', from).lte('created_at', to),
    supabase.from('payroll_periods').select('id').eq('year', y).eq('month', m).maybeSingle(),
  ])

  let adj = [], item = null
  if (period.data) {
    const [a, it] = await Promise.all([
      supabase.from('payroll_adjustments').select('type, amount').eq('employee_id', employeeId)
        .eq('period_id', period.data.id).eq('status', 'approved'),
      supabase.from('payroll_items').select('id').eq('employee_id', employeeId).eq('period_id', period.data.id).maybeSingle(),
    ])
    adj = a.data || []
    item = it.data
  }
  // Berilgan oylik: shu oy hisobiga bog'langan to'lovlar (keyingi oyda berilgan bo'lsa ham)
  const pay = item
    ? await supabase.from('payments').select('amount').eq('payroll_item_id', item.id)
    : await supabase.from('payments').select('amount').eq('employee_id', employeeId).gte('payment_date', from).lte('payment_date', to)

  const sessions = sess.data || []
  const rate = (rates.data || []).find(r => r.effective_from <= `${monthKey}-${pad2(last)}` && (!r.effective_to || r.effective_to > `${monthKey}-01`))
  const monthly = rate?.salary_type === 'monthly'
  const earned  = monthly ? num(rate.monthly_salary) : sessions.reduce((t, x) => t + num(x.earned_amount), 0)
  const advance = (adv.data || []).reduce((t, x) => t + num(x.amount), 0)
  const bonus   = adj.filter(a => a.type === 'bonus').reduce((t, a) => t + num(a.amount), 0)
  const fine    = adj.filter(a => a.type === 'deduction').reduce((t, a) => t + num(a.amount), 0)
  const paid    = (pay.data || []).reduce((t, x) => t + num(x.amount), 0)
  const net     = Math.max(0, Math.round(earned + bonus - fine - advance))
  return {
    days: new Set(sessions.map(x => new Date(x.check_in_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' }))).size,
    secs: sessions.reduce((t, x) => t + num(x.worked_seconds), 0),
    monthly, earned, advance, bonus, fine, paid,
    // Yana avans berish mumkin bo'lgan summa (ishlab topgani − avans − berilgan)
    canGive: Math.max(0, net - paid),
  }
}

const UZ_MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr']
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })
const nowTime = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' })
// Oyning oxirgi kuni: "2026-10-31"
const lastDayKey = (d) => {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

export default function AdminAdvances() {
  const { matchEmployee } = useBranch()
  const { user } = useAuth()
  const [advances, setAdvances]   = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]     = useState(true)
  const [empFilter, setEmpFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [selectedAdv, setSelectedAdv] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [form, setForm]           = useState({
    employee_id: '', amount: '', payment_type: 'cash', notes: '', date: todayKey()
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState('')
  const [summary, setSummary]       = useState(null)
  const [confirmWarn, setConfirmWarn] = useState(false) // ogohlantirish ko'rsatildi, "Baribir berish" kutilmoqda

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [advs, emps] = await Promise.all([
        advanceFunctions.getAll(empFilter ? { employeeId: empFilter } : {}),
        employeeFunctions.getAll({ status: 'active' }),
      ])
      const list = advs.filter(a => matchEmployee(a.employees))
      // Kim bergani: admin yoki menejer ismi
      const ids = [...new Set(list.map(a => a.given_by).filter(Boolean))]
      if (ids.length) {
        const { data: who } = await supabase.rpc('payment_recorders', { p_ids: ids })
        const byId = Object.fromEntries((who || []).map(w => [w.id, w]))
        list.forEach(a => { a.giver = byId[a.given_by] })
      }
      setAdvances(list)
      setEmployees(emps.filter(matchEmployee))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [empFilter, matchEmployee])

  useEffect(() => { load() }, [load])

  // Xodim yoki oy tanlanganda — o'sha oydagi holatini ko'rsatamiz
  const monthKey = form.date.slice(0, 7)
  useEffect(() => {
    setSummary(null)
    setConfirmWarn(false)
    if (!form.employee_id) return
    let alive = true
    loadMonthSummary(form.employee_id, monthKey)
      .then(r => alive && setSummary(r))
      .catch(() => alive && setSummary(null))
    return () => { alive = false }
  }, [form.employee_id, monthKey])

  const isPastMonth = monthKey < todayKey().slice(0, 7)
  const amountNum = parseFloat(form.amount) || 0
  // Nimadan ogohlantiramiz
  const warning = !summary ? null
    : isPastMonth && summary.paid > 0
      ? `${UZ_MONTHS[Number(monthKey.slice(5, 7)) - 1]} oyi uchun oylik allaqachon berilgan (${formatMoney(summary.paid)}). O'tib ketgan oyga avans berish tavsiya etilmaydi.`
    : summary.paid > 0 && summary.canGive <= 0
      ? `Bu oy oyligi to'liq berib bo'lingan (${formatMoney(summary.paid)}). Yana avans berilsa, xodim qarzdor bo'lib qoladi.`
    : amountNum > summary.canGive
      ? `Bu summa xodim shu oy ishlab topganidan ko'p. Ko'pi bilan ${formatMoney(summary.canGive)} berish mumkin.`
    : null

  const handleSubmit = async () => {
    if (!form.employee_id || !form.amount || parseFloat(form.amount) <= 0) {
      setFormError("Xodim va summa majburiy")
      return
    }
    // Ogohlantirish bo'lsa — avval tasdiqlash
    if (warning && !confirmWarn) {
      setConfirmWarn(true)
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      await advanceFunctions.create({
        employee_id:  form.employee_id,
        amount:       parseFloat(form.amount),
        payment_type: form.payment_type,
        notes:        form.notes,
        // Tanlangan kun (hozirgi soat bilan) — avans o'sha oy oyligidan ayiriladi
        created_at:   new Date(`${form.date}T${nowTime()}:00+05:00`).toISOString(),
        given_by:     user.id,
      })
      setShowModal(false)
      setForm({ employee_id: '', amount: '', payment_type: 'cash', notes: '', date: todayKey() })
      setConfirmWarn(false)
      load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      alert("Bekor qilish sababini kiriting")
      return
    }
    setSubmitting(true)
    try {
      await advanceFunctions.cancel(selectedAdv.id, cancelReason, user.id)
      setCancelModal(false)
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const exportExcel = () => {
    const rows = advances.map(a => ({
      "Xodim":    a.employees?.full_name || '—',
      "Summa":    a.amount,
      "To'lov turi": a.payment_type,
      "Sana":     formatTashkentDateTime(a.created_at),
      "Kim berdi": a.giver ? `${a.giver.full_name}${a.giver.role === 'manager' ? ' (menejer)' : ''}` : (a.given_by ? 'Admin' : '—'),
      "Izoh":     a.notes || '—',
      "Holat":    a.status === 'active' ? 'Faol' : 'Bekor qilingan',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Avanslar")
    XLSX.writeFile(wb, `avanslar.xlsx`)
  }

  const activeTotal    = advances.filter(a => a.status === 'active').reduce((s, a) => s + a.amount, 0)
  const cancelledTotal = advances.filter(a => a.status === 'cancelled').reduce((s, a) => s + a.amount, 0)

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <LuWallet size={20} className="text-emerald-700" />
            Avanslar
          </h1>
          <p className="page-subtitle">{advances.length} ta avans yozuvi</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary text-xs" title="Yangilash">
            <LuRefreshCw size={14} />
          </button>
          <button onClick={exportExcel} className="btn-secondary text-xs">
            <LuDownload size={14} /> Excel
          </button>
          <button id="add-advance-btn" onClick={() => setShowModal(true)} className="btn-primary">
            <LuPlus size={16} /> Avans qo'shish
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="stat-card">
          <p className="text-xs text-dark-500">Faol avanslar jami</p>
          <p className="text-base font-bold text-purple-400">{formatMoney(activeTotal)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-dark-500">Bekor qilingan</p>
          <p className="text-base font-bold text-dark-500">{formatMoney(cancelledTotal)}</p>
        </div>
      </div>

      {/* Filter */}
      <select
        value={empFilter}
        onChange={e => setEmpFilter(e.target.value)}
        className="input-field w-auto"
        id="advance-emp-filter"
      >
        <option value="">Barcha xodimlar</option>
        {employees.map(emp => (
          <option key={emp.id} value={emp.id}>{emp.full_name}</option>
        ))}
      </select>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-dark-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : advances.length === 0 ? (
        <div className="card text-center py-12">
          <LuWallet size={36} className="mx-auto text-dark-600 mb-3" />
          <p className="text-dark-500 text-sm mb-4">Avans yozuvlari yo'q</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mx-auto">
            <LuPlus size={14} /> Avans qo'shish
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-head">Xodim</th>
                <th className="table-head">Summa</th>
                <th className="table-head hidden md:table-cell">To'lov turi</th>
                <th className="table-head hidden lg:table-cell">Sana</th>
                <th className="table-head">Kim berdi</th>
                <th className="table-head hidden lg:table-cell">Izoh</th>
                <th className="table-head">Holat</th>
                <th className="table-head">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {advances.map(adv => (
                <tr key={adv.id} className={`table-row ${adv.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td className="table-cell font-medium text-dark-200">{adv.employees?.full_name}</td>
                  <td className="table-cell font-bold text-purple-400">{formatMoney(adv.amount)}</td>
                  <td className="table-cell hidden md:table-cell text-dark-400 text-xs">
                    <PaymentMethod method={adv.payment_type} />
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-dark-400">
                    {formatTashkentDateTime(adv.created_at)}
                  </td>
                  <td className="table-cell text-sm">
                    {adv.giver?.role === 'manager'
                      ? <span className="badge-blue">{adv.giver.full_name} · menejer</span>
                      : <span className="text-slate-600">{adv.giver?.full_name || (adv.given_by ? 'Admin' : '—')}</span>}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-dark-500">
                    {adv.notes || '—'}
                  </td>
                  <td className="table-cell">
                    {adv.status === 'active'
                      ? <span className="badge-green">Faol</span>
                      : <span className="badge-gray">Bekor</span>
                    }
                  </td>
                  <td className="table-cell">
                    {adv.status === 'active' && (
                      <button
                        onClick={() => { setSelectedAdv(adv); setCancelReason(''); setCancelModal(true) }}
                        className="p-1.5 rounded-lg text-dark-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Bekor qilish"
                      >
                        <LuCircleX size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-dark-700">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <LuWallet size={16} className="text-purple-400" />
                Avans qo'shish
              </h2>
              <button onClick={() => setShowModal(false)} className="text-dark-500 hover:text-dark-300">
                <LuX size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <LuCircleAlert size={14} className="text-red-400" />
                  <p className="text-red-400 text-xs">{formError}</p>
                </div>
              )}

              <div>
                <label className="label">Xodim *</label>
                <select
                  value={form.employee_id}
                  onChange={e => setForm({...form, employee_id: e.target.value})}
                  className="input-field"
                  id="advance-employee-select"
                >
                  <option value="">Xodimni tanlang</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                  ))}
                </select>
              </div>

              {form.employee_id && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60">
                  <p className="text-xs font-semibold text-slate-500 mb-2">
                    {UZ_MONTHS[Number(monthKey.slice(5, 7)) - 1].toUpperCase()} {monthKey.slice(0, 4)} HOLATI
                  </p>
                  {!summary ? (
                    <p className="text-sm text-slate-400">Yuklanmoqda...</p>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      <Row label="Ishladi" value={`${summary.days} kun · ${hoursText(summary.secs)}`} />
                      <Row label={summary.monthly ? 'Oylik maosh' : 'Ishlab topdi'} value={formatMoney(summary.earned)} />
                      {summary.bonus > 0 && <Row label="Bonus" value={`+${formatMoney(summary.bonus)}`} tone="text-green-700" />}
                      {summary.fine > 0 && <Row label="Jarima" value={`−${formatMoney(summary.fine)}`} tone="text-red-600" />}
                      <Row label="Avans olgan" value={summary.advance ? `−${formatMoney(summary.advance)}` : '0'} tone={summary.advance ? 'text-red-600' : 'text-slate-400'} />
                      <Row label="Oylik berilgan" value={summary.paid ? `−${formatMoney(summary.paid)}` : '0'} tone={summary.paid ? 'text-green-700' : 'text-slate-400'} />
                      <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-200">
                        <span className="font-medium text-slate-900">Yana berish mumkin</span>
                        <span className={`text-lg font-bold ${summary.canGive > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatMoney(summary.canGive)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="label">Summa (so'm) *</label>
                <input
                  type="number"
                  value={form.amount}
                  onChange={e => { setForm({...form, amount: e.target.value}); setConfirmWarn(false) }}
                  placeholder="100000"
                  className="input-field"
                  min="1"
                />
              </div>

              <div>
                <label className="label">Qaysi kun (qaysi oy hisobidan)</label>
                <input
                  type="date"
                  value={form.date}
                  max={todayKey()}
                  onChange={e => setForm({...form, date: e.target.value || todayKey()})}
                  className="input-field"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[0, 1, 2].map(back => {
                    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back)
                    const key = back === 0 ? todayKey() : lastDayKey(d)
                    const active = form.date.slice(0, 7) === key.slice(0, 7)
                    return (
                      <button key={back} type="button" onClick={() => setForm({...form, date: key})}
                        className={`h-8 px-3 rounded-full border text-xs cursor-pointer ${active ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-medium' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                        {UZ_MONTHS[d.getMonth()]}{back === 0 ? ' (shu oy)' : ''}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Avans <b>{UZ_MONTHS[Number(form.date.slice(5, 7)) - 1]} {form.date.slice(0, 4)}</b> oyligidan ayiriladi.
                </p>
              </div>

              <div>
                <label className="label">To'lov turi</label>
                <select
                  value={form.payment_type}
                  onChange={e => setForm({...form, payment_type: e.target.value})}
                  className="input-field"
                >
                  <option value="cash">Naqd pul</option>
                  <option value="card">Plastik karta</option>
                  <option value="transfer">Bank o'tkazmasi</option>
                </select>
              </div>

              <div>
                <label className="label">Izoh</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({...form, notes: e.target.value})}
                  placeholder="Qo'shimcha izoh..."
                  className="input-field resize-none"
                  rows={2}
                />
              </div>
            </div>

            {warning && (
              <div className={`mx-5 mb-4 rounded-lg border px-4 py-3 text-sm flex gap-2 ${confirmWarn ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <LuTriangleAlert size={18} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p>{warning}</p>
                  {confirmWarn && <p className="font-medium mt-1">Baribir berilsinmi? Bo'lsa «Baribir berish» ni bosing.</p>}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Bekor qilish</button>
              <button onClick={handleSubmit} disabled={submitting} className={`${confirmWarn ? 'btn-danger' : 'btn-primary'} disabled:opacity-50`}>
                {submitting && <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />}
                <LuWallet size={14} /> {confirmWarn ? 'Baribir berish' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {cancelModal && selectedAdv && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCancelModal(false)}>
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-dark-700">
              <h2 className="text-base font-semibold text-slate-900">Avansni bekor qilish</h2>
              <button onClick={() => setCancelModal(false)} className="text-dark-500 hover:text-dark-300">
                <LuX size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-dark-900 rounded-lg px-3 py-2.5">
                <p className="text-dark-200 text-sm">{selectedAdv.employees?.full_name}</p>
                <p className="text-purple-400 font-bold">{formatMoney(selectedAdv.amount)}</p>
              </div>
              <div>
                <label className="label">Bekor qilish sababi *</label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="Sabab kiriting..."
                  className="input-field resize-none"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setCancelModal(false)} className="btn-secondary">Bekor qilish</button>
              <button onClick={handleCancel} disabled={submitting} className="btn-danger">
                {submitting && <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" />}
                <LuCircleX size={14} /> Bekor qilish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-600">{label}</span>
      <span className={`font-medium tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}
