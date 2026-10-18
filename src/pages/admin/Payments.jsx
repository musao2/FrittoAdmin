import { useState, useEffect, useCallback } from 'react'
import { LuCreditCard, LuRefreshCw, LuDownload } from "react-icons/lu"
import { payrollFunctions, formatMoney, formatTashkentDateTime, supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'
import PaymentMethod from '../../components/admin/PaymentMethod'
import { useBranch } from '../../context/BranchContext'

const recorderLabel = (p) => p.recorder
  ? `${p.recorder.full_name}${p.recorder.role === 'manager' ? ' (menejer)' : ''}`
  : (p.recorded_by ? 'Admin' : '—')

export default function AdminPayments() {
  const { matchEmployee } = useBranch()
  const [payments, setPayments] = useState([])
  const [loading, setLoading]   = useState(true)
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  )
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await payrollFunctions.getPayments({
        from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
        to:   dateTo   ? `${dateTo}T23:59:59`   : undefined,
      })
      const list = data.filter(p => matchEmployee(p.employees))
      // Kim bergani: admin yoki menejer ismi
      const ids = [...new Set(list.map(p => p.recorded_by).filter(Boolean))]
      if (ids.length) {
        const { data: who } = await supabase.rpc('payment_recorders', { p_ids: ids })
        const byId = Object.fromEntries((who || []).map(w => [w.id, w]))
        list.forEach(p => { p.recorder = byId[p.recorded_by] })
      }
      setPayments(list)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, matchEmployee])

  useEffect(() => { load() }, [load])

  const total = payments.reduce((s, p) => s + p.amount, 0)

  const exportExcel = () => {
    const rows = payments.map(p => ({
      "Xodim":        p.employees?.full_name || '—',
      "Summa":        p.amount,
      "To'lov usuli": p.payment_method,
      "Sana":         formatTashkentDateTime(p.payment_date),
      "Kim berdi":    recorderLabel(p),
      "Izoh":         p.notes || '—',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "To'lovlar")
    XLSX.writeFile(wb, `tolovlar_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <LuCreditCard size={20} className="text-emerald-700" />
            To'lovlar tarixi
          </h1>
          <p className="page-subtitle">{payments.length} ta to'lov</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-secondary text-xs">
            <LuDownload size={14} /> Excel
          </button>
          <button onClick={load} className="p-2 text-dark-400 hover:text-dark-200 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 rounded-xl border border-slate-200">
            <LuRefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="stat-card">
        <p className="text-xs text-dark-500">Davr bo'yicha jami to'lovlar</p>
        <p className="text-2xl font-bold text-blue-400">{formatMoney(total)}</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-field w-auto" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="input-field w-auto" />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-dark-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : payments.length === 0 ? (
        <div className="card text-center py-12">
          <LuCreditCard size={36} className="mx-auto text-dark-600 mb-3" />
          <p className="text-dark-500 text-sm">To'lovlar topilmadi</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-head">Xodim</th>
                <th className="table-head">Summa</th>
                <th className="table-head hidden md:table-cell">Usul</th>
                <th className="table-head">Sana</th>
                <th className="table-head">Kim berdi</th>
                <th className="table-head hidden lg:table-cell">Izoh</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(pay => (
                <tr key={pay.id} className="table-row">
                  <td className="table-cell font-medium text-dark-200">{pay.employees?.full_name}</td>
                  <td className="table-cell font-bold text-blue-400">{formatMoney(pay.amount)}</td>
                  <td className="table-cell hidden md:table-cell text-dark-400 text-xs">
                    <PaymentMethod method={pay.payment_method} />
                  </td>
                  <td className="table-cell text-xs text-dark-400">{formatTashkentDateTime(pay.payment_date)}</td>
                  <td className="table-cell text-sm">
                    {pay.recorder?.role === 'manager'
                      ? <span className="badge-blue">{pay.recorder.full_name} · menejer</span>
                      : <span className="text-slate-600">{recorderLabel(pay)}</span>}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-dark-500">{pay.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
