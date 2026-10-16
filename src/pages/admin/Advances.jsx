import { useState, useEffect, useCallback } from 'react'
import {
  LuWallet, LuPlus, LuCircleX, LuRefreshCw, LuX, LuDownload, LuCircleAlert
} from "react-icons/lu"
import {
  advanceFunctions, employeeFunctions, formatMoney,
  formatTashkentDateTime
} from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import * as XLSX from 'xlsx'
import PaymentMethod from '../../components/admin/PaymentMethod'
import { useBranch } from '../../context/BranchContext'

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
    employee_id: '', amount: '', payment_type: 'cash', notes: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [advs, emps] = await Promise.all([
        advanceFunctions.getAll(empFilter ? { employeeId: empFilter } : {}),
        employeeFunctions.getAll({ status: 'active' }),
      ])
      setAdvances(advs.filter(a => matchEmployee(a.employees)))
      setEmployees(emps.filter(matchEmployee))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [empFilter, matchEmployee])

  useEffect(() => { load() }, [load])

  const handleSubmit = async () => {
    if (!form.employee_id || !form.amount || parseFloat(form.amount) <= 0) {
      setFormError("Xodim va summa majburiy")
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
        given_by:     user.id,
      })
      setShowModal(false)
      setForm({ employee_id: '', amount: '', payment_type: 'cash', notes: '' })
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

              <div>
                <label className="label">Summa (so'm) *</label>
                <input
                  type="number"
                  value={form.amount}
                  onChange={e => setForm({...form, amount: e.target.value})}
                  placeholder="100000"
                  className="input-field"
                  min="1"
                />
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

            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Bekor qilish</button>
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">
                {submitting && <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />}
                <LuWallet size={14} /> Saqlash
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
