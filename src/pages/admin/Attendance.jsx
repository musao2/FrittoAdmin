import { useState, useEffect, useCallback } from 'react'
import {
  LuClock, LuSearch, LuFilter, LuTriangleAlert, LuCircleCheck,
  LuPencil, LuRefreshCw, LuX, LuSave, LuCalendar, LuUser, LuDownload
} from "react-icons/lu"
import {
  attendanceFunctions, employeeFunctions, formatTashkentDateTime,
  formatDuration, formatMoney
} from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import * as XLSX from 'xlsx'
import { useBranch } from '../../context/BranchContext'
import { usePhotoUrls, PhotoCell, PhotoViewer } from '../../components/admin/AttendancePhotos'

const STATUS_CONFIG = {
  open:      { label: 'Davom etmoqda', cls: 'badge-yellow' },
  closed:    { label: 'Yakunlandi',    cls: 'badge-green' },
  corrected: { label: 'Tuzatilgan',   cls: 'badge-blue' },
}

export default function AdminAttendance() {
  const { matchEmployee } = useBranch()
  const { user } = useAuth()
  const [sessions, setSessions]     = useState([])
  const [photo, setPhoto]           = useState(null)
  const [employees, setEmployees]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [empFilter, setEmpFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom]     = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  )
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [editModal, setEditModal]   = useState(false)
  const [editSession, setEditSession] = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editReason, setEditReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sess, emps] = await Promise.all([
        attendanceFunctions.getAll({
          from:       dateFrom ? `${dateFrom}T00:00:00` : undefined,
          to:         dateTo   ? `${dateTo}T23:59:59` : undefined,
          employeeId: empFilter || undefined,
          status:     statusFilter || undefined,
        }),
        employeeFunctions.getAll(),
      ])
      setSessions(sess.filter(s => matchEmployee(s.employees)))
      setEmployees(emps.filter(matchEmployee))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, empFilter, statusFilter, matchEmployee])

  useEffect(() => { load() }, [load])

  const filtered = sessions.filter(sess =>
    !search ||
    sess.employees?.full_name?.toLowerCase().includes(search.toLowerCase())
  )
  const photoUrls = usePhotoUrls(filtered)

  const openEdit = (sess) => {
    setEditSession(sess)
    setEditForm({
      check_in_at:  sess.check_in_at ? new Date(sess.check_in_at).toISOString().slice(0, 16) : '',
      check_out_at: sess.check_out_at ? new Date(sess.check_out_at).toISOString().slice(0, 16) : '',
      notes:        sess.notes || '',
    })
    setEditReason('')
    setEditModal(true)
  }

  const handleSave = async () => {
    if (!editReason.trim()) {
      alert('Tuzatish sababini kiriting')
      return
    }
    setSubmitting(true)
    try {
      const checkIn  = new Date(editForm.check_in_at)
      const checkOut = editForm.check_out_at ? new Date(editForm.check_out_at) : null

      let workedSeconds = editSession.worked_seconds
      if (checkOut) {
        workedSeconds = Math.max(0, Math.floor((checkOut - checkIn) / 1000))
      }

      const earnedAmount = (workedSeconds / 3600) * (editSession.hourly_rate_snapshot || 0)

      await attendanceFunctions.adminCorrect(
        editSession.id,
        {
          check_in_at:  checkIn.toISOString(),
          check_out_at: checkOut?.toISOString() || null,
          worked_seconds: workedSeconds,
          earned_amount:  Math.round(earnedAmount),
          status: checkOut ? 'corrected' : editSession.status,
          notes:  editForm.notes,
        },
        editReason,
        user.id
      )
      setEditModal(false)
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const exportExcel = () => {
    const rows = filtered.map(s => ({
      "Xodim":       s.employees?.full_name || '—',
      "Filial":      s.employees?.branch || '—',
      "Kelgan vaqti":    formatTashkentDateTime(s.check_in_at),
      "Ketgan vaqti":   s.check_out_at ? formatTashkentDateTime(s.check_out_at) : '—',
      "Ishlangan vaqt": formatDuration(s.worked_seconds),
      "Ish haqi":    s.earned_amount || 0,
      "Holat":       STATUS_CONFIG[s.status]?.label || s.status,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Davomat')
    XLSX.writeFile(wb, `davomat_${dateFrom}_${dateTo}.xlsx`)
  }

  const totalWorked  = filtered.reduce((s, sess) => s + (sess.worked_seconds || 0), 0)
  const totalEarned  = filtered.reduce((s, sess) => s + (sess.earned_amount || 0), 0)
  const openCount    = filtered.filter(s => s.status === 'open').length

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <LuClock size={20} className="text-emerald-700" />
            Davomat
          </h1>
          <p className="page-subtitle">{filtered.length} ta yozuv</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-secondary text-xs">
            <LuDownload size={14} /> Excel
          </button>
          <button
            onClick={load}
            className="p-2 text-dark-400 hover:text-dark-200 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 rounded-xl border border-slate-200"
          >
            <LuRefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card">
          <p className="text-xs text-dark-500">Jami ishlangan vaqt</p>
          <p className="text-sm font-bold text-dark-100">{formatDuration(totalWorked)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-dark-500">Jami ish haqi</p>
          <p className="text-sm font-bold text-emerald-700">{formatMoney(totalEarned)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-dark-500">Hozir ishlayotgan</p>
          <p className="text-2xl font-bold text-amber-400">{openCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="input-field w-auto"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="input-field w-auto"
        />
        <select
          value={empFilter}
          onChange={e => setEmpFilter(e.target.value)}
          className="input-field w-auto"
          id="attendance-emp-filter"
        >
          <option value="">Barcha xodimlar</option>
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>{emp.full_name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input-field w-auto"
        >
          <option value="">Barcha holat</option>
          <option value="open">Davom etmoqda</option>
          <option value="closed">Yakunlandi</option>
          <option value="corrected">Tuzatilgan</option>
        </select>
        <div className="relative flex-1 min-w-40">
          <LuSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Xodim nomi..."
            className="input-field pl-8"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-dark-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <LuClock size={36} className="mx-auto text-dark-600 mb-3" />
          <p className="text-dark-500 text-sm">Davomat yozuvlari topilmadi</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-head">Xodim</th>
                <th className="table-head">Rasm</th>
                <th className="table-head">Keldi</th>
                <th className="table-head">Ketdi</th>
                <th className="table-head hidden md:table-cell">Ishlangan</th>
                <th className="table-head hidden lg:table-cell">Ish haqi</th>
                <th className="table-head">Holat</th>
                <th className="table-head">Tuzatish</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sess => {
                const statusInfo = STATUS_CONFIG[sess.status] || STATUS_CONFIG.closed
                return (
                  <tr key={sess.id} className="table-row">
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-dark-200 text-sm">{sess.employees?.full_name}</p>
                        <p className="text-xs text-dark-500">{sess.employees?.branch}</p>
                      </div>
                    </td>
                    <td className="table-cell"><PhotoCell session={sess} urls={photoUrls} onOpen={setPhoto} /></td>
                    <td className="table-cell text-xs">{formatTashkentDateTime(sess.check_in_at)}</td>
                    <td className="table-cell text-xs">
                      {sess.check_out_at
                        ? formatTashkentDateTime(sess.check_out_at)
                        : <span className="badge-yellow text-xs">Ochiq</span>
                      }
                    </td>
                    <td className="table-cell hidden md:table-cell text-xs">
                      {formatDuration(sess.worked_seconds)}
                    </td>
                    <td className="table-cell hidden lg:table-cell text-emerald-700 font-medium text-xs">
                      {formatMoney(sess.earned_amount)}
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-col gap-0.5">
                        <span className={statusInfo.cls}>{statusInfo.label}</span>
                        {sess.admin_corrected && (
                          <span className="text-xs text-blue-400">Admin tuzatdi</span>
                        )}
                        {sess.lateness_type === 'late' && (
                          <span className="badge-red text-xs">
                            {sess.lateness_minutes}daq kechikdi
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={() => openEdit(sess)}
                        className="p-1.5 rounded-lg text-dark-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                        title="Tuzatish"
                      >
                        <LuPencil size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editModal && editSession && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditModal(false)}>
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-dark-700">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <LuPencil size={16} className="text-amber-400" />
                Davomat yozuvini tuzatish
              </h2>
              <button onClick={() => setEditModal(false)} className="text-dark-500 hover:text-dark-300">
                <LuX size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-dark-900 rounded-lg px-3 py-2 text-sm">
                <p className="font-medium text-dark-200">{editSession.employees?.full_name}</p>
                <p className="text-dark-500 text-xs">Stavka: {formatMoney(editSession.hourly_rate_snapshot)}/soat</p>
              </div>

              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <p className="text-xs text-amber-400 font-medium flex items-center gap-1.5">
                  <LuTriangleAlert size={12} /> Diqqat
                </p>
                <p className="text-xs text-dark-500 mt-0.5">
                  Admin tuzatishlarining barchasi audit logga qayd etiladi.
                </p>
              </div>

              <div>
                <label className="label">Kelgan vaqti</label>
                <input
                  type="datetime-local"
                  value={editForm.check_in_at}
                  onChange={e => setEditForm({...editForm, check_in_at: e.target.value})}
                  className="input-field"
                />
              </div>

              <div>
                <label className="label">Ketgan vaqti (ixtiyoriy)</label>
                <input
                  type="datetime-local"
                  value={editForm.check_out_at}
                  onChange={e => setEditForm({...editForm, check_out_at: e.target.value})}
                  className="input-field"
                />
              </div>

              <div>
                <label className="label">Izoh</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={e => setEditForm({...editForm, notes: e.target.value})}
                  placeholder="Qo'shimcha izoh..."
                  className="input-field"
                />
              </div>

              <div>
                <label className="label">Tuzatish sababi *</label>
                <textarea
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="Nima sababdan tuzatildi? (majburiy)"
                  className="input-field resize-none"
                  rows={2}
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setEditModal(false)} className="btn-secondary">Bekor qilish</button>
              <button
                onClick={handleSave}
                disabled={submitting || !editReason.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {submitting && <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />}
                <LuSave size={14} /> Saqlash
              </button>
            </div>
          </div>
        </div>
      )}
      <PhotoViewer photo={photo} onClose={() => setPhoto(null)} />
    </div>
  )
}
