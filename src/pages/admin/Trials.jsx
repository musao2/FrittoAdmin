import { useState, useEffect, useCallback } from 'react'
import {
  LuClipboardList, LuCircleCheck, LuCircleX, LuClock, LuTriangleAlert,
  LuChevronRight, LuCalendar, LuUser, LuRefreshCw, LuX, LuPlus,
  LuCalendarPlus,
  LuLightbulb
} from "react-icons/lu"
import { trialFunctions, employeeFunctions, formatTashkentDate } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const STATUS_CONFIG = {
  in_progress:       { label: 'Test davom etmoqda', cls: 'badge-yellow', icon: <LuClock size={12} /> },
  awaiting_decision: { label: 'Qaror kutilmoqda',  cls: 'badge-blue',   icon: <LuTriangleAlert size={12} /> },
  confirmed:         { label: 'Tasdiqlangan',       cls: 'badge-green',  icon: <LuCircleCheck size={12} /> },
  rejected:          { label: 'Rad etilgan',        cls: 'badge-red',    icon: <LuCircleX size={12} /> },
  extended:          { label: 'Uzaytirilgan',       cls: 'badge-purple', icon: <LuChevronRight size={12} /> },
  pending:           { label: 'Kutilmoqda',         cls: 'badge-gray',   icon: <LuClock size={12} /> },
}

export default function AdminTrials() {
  const { user } = useAuth()
  const [trials, setTrials]   = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('')
  const [selected, setSelected] = useState(null)
  const [decisionModal, setDecisionModal] = useState(false)
  const [decisionType, setDecisionType]   = useState('')
  const [notes, setNotes]   = useState('')
  const [extendDate, setExtendDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [assignModal, setAssignModal] = useState(false)
  const [assignForm, setAssignForm] = useState({
    employee_id: '',
    days_count: 5,
    start_date: new Date().toISOString().split('T')[0],
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [trialsData, empsData] = await Promise.all([
        trialFunctions.getAll(),
        employeeFunctions.getAll(),
      ])
      setTrials(trialsData)
      setEmployees(empsData)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = trials.filter(t =>
    !filter || t.status === filter
  )

  const openDecision = (trial, type) => {
    setSelected(trial)
    setDecisionType(type)
    setNotes('')
    setExtendDate('')
    setDecisionModal(true)
  }

  const handleDecision = async () => {
    if (!selected) return
    setSubmitting(true)
    try {
      if (decisionType === 'approve') {
        await trialFunctions.approve(selected.id, selected.employee_id, notes)
      } else if (decisionType === 'reject') {
        await trialFunctions.reject(selected.id, selected.employee_id, notes)
      } else if (decisionType === 'extend') {
        if (!extendDate) return
        await trialFunctions.extend(selected.id, extendDate, notes)
      }
      setDecisionModal(false)
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const getTrialProgress = (trial) => {
    const day = trialFunctions.getTrialDay(trial.trial_start_date)
    return { day, total: trial.days_count || 5 }
  }

  const activeCount    = trials.filter(t => t.status === 'in_progress' || t.status === 'awaiting_decision').length
  const confirmedCount = trials.filter(t => t.status === 'confirmed').length
  const rejectedCount  = trials.filter(t => t.status === 'rejected').length

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <LuClipboardList size={20} className="text-amber-600" />
            Test rejimi
          </h1>
          <p className="page-subtitle">{activeCount} ta xodim sinov muddatida</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 text-dark-400 hover:text-dark-200 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 rounded-xl border border-slate-200 transition-colors"
            title="Yangilash"
          >
            <LuRefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setAssignForm({
                employee_id: employees[0]?.id || '',
                days_count: 5,
                start_date: new Date().toISOString().split('T')[0],
              })
              setAssignModal(true)
            }}
            className="btn-primary"
          >
            <LuPlus size={16} /> Test rejimi tayinlash
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card">
          <p className="text-xs text-dark-500">Aktiv testlar</p>
          <p className="text-2xl font-bold text-amber-400">{activeCount}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-dark-500">Tasdiqlangan</p>
          <p className="text-2xl font-bold text-emerald-400">{confirmedCount}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-dark-500">Rad etilgan</p>
          <p className="text-2xl font-bold text-red-400">{rejectedCount}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {[
          { value: '',               label: 'Barchasi' },
          { value: 'in_progress',    label: 'Davom etmoqda' },
          { value: 'awaiting_decision', label: 'Qaror kutilmoqda' },
          { value: 'confirmed',      label: 'Tasdiqlangan' },
          { value: 'rejected',       label: 'Rad etilgan' },
          { value: 'extended',       label: 'Uzaytirilgan' },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              filter === opt.value
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-dark-800 text-dark-400 border border-dark-700 hover:border-dark-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Trials list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-dark-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <LuClipboardList size={36} className="mx-auto text-dark-600 mb-3" />
          <p className="text-dark-500 text-sm">Test yozuvlari topilmadi</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(trial => {
            const config   = STATUS_CONFIG[trial.status] || STATUS_CONFIG.pending
            const progress = getTrialProgress(trial)
            const isActive = trial.status === 'in_progress' || trial.status === 'awaiting_decision'

            return (
              <div key={trial.id} className="card hover:border-dark-600 transition-all duration-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-dark-700 border border-dark-600 flex items-center justify-center flex-shrink-0">
                      <LuUser size={16} className="text-dark-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-dark-100 text-sm">
                          {trial.employees?.full_name}
                        </p>
                        <span className={config.cls}>
                          {config.icon} {config.label}
                        </span>
                      </div>
                      <p className="text-xs text-dark-500 mt-0.5">{trial.employees?.position} · {trial.employees?.branch}</p>

                      <div className="flex items-center gap-4 mt-2 text-xs text-dark-500">
                        <span className="flex items-center gap-1">
                          <LuCalendar size={11} />
                          Boshlangan: {formatTashkentDate(trial.trial_start_date)}
                        </span>
                        <span>
                          Tugaydi: {formatTashkentDate(trial.trial_end_date)}
                        </span>
                      </div>

                      {(trial.status === 'in_progress' || trial.status === 'extended') && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-dark-500">
                              {Math.min(progress.day, progress.total)}/{progress.total} kun
                            </span>
                            <span className="text-dark-500">
                              {Math.round((Math.min(progress.day, progress.total) / progress.total) * 100)}%
                            </span>
                          </div>
                          <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min((progress.day / progress.total) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {trial.decision_notes && (
                        <p className="text-xs text-dark-500 mt-1.5 italic">
                          "{trial.decision_notes}"
                        </p>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        id={`approve-trial-${trial.id}`}
                        onClick={() => openDecision(trial, 'approve')}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all text-xs flex items-center gap-1"
                      >
                        <LuCircleCheck size={12} /> Tasdiqlash
                      </button>
                      <button
                        id={`extend-trial-${trial.id}`}
                        onClick={() => openDecision(trial, 'extend')}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all text-xs"
                        title="Uzaytirish"
                      >
                        <LuChevronRight size={12} />
                      </button>
                      <button
                        id={`reject-trial-${trial.id}`}
                        onClick={() => openDecision(trial, 'reject')}
                        className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all text-xs"
                        title="Rad etish"
                      >
                        <LuCircleX size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Decision modal */}
      {decisionModal && selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDecisionModal(false)}>
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-dark-700">
              <h2 className="text-base font-semibold text-slate-900">
                {decisionType === 'approve' ? <span className="flex items-center gap-2"><LuCircleCheck size={18} className="text-green-600" /> Ishga qabul qilish</span> :
                 decisionType === 'reject'  ? <span className="flex items-center gap-2"><LuCircleX size={18} className="text-red-600" /> Rad etish</span> :
                                              <span className="flex items-center gap-2"><LuCalendarPlus size={18} className="text-emerald-600" /> Sinov muddatini uzaytirish</span>}
              </h2>
              <button onClick={() => setDecisionModal(false)} className="text-dark-500 hover:text-dark-300">
                <LuX size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-dark-900 rounded-lg px-3 py-2.5 text-sm">
                <p className="font-medium text-dark-200">{selected.employees?.full_name}</p>
                <p className="text-dark-500 text-xs">{selected.employees?.position}</p>
              </div>

              {decisionType === 'extend' && (
                <div>
                  <label className="label">Yangi tugash sanasi *</label>
                  <input
                    type="date"
                    value={extendDate}
                    onChange={e => setExtendDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="input-field"
                  />
                </div>
              )}

              <div>
                <label className="label">
                  {decisionType === 'approve' ? 'Izoh (ixtiyoriy)' :
                   decisionType === 'reject'  ? 'Rad etish sababi *' :
                                                'Uzaytirish sababi *'}
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Izoh kiriting..."
                  className="input-field resize-none"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setDecisionModal(false)} className="btn-secondary">
                Bekor qilish
              </button>
              <button
                onClick={handleDecision}
                disabled={submitting || (decisionType === 'extend' && !extendDate)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-50 ${
                  decisionType === 'approve' ? 'bg-emerald-500 hover:bg-emerald-400 text-white' :
                  decisionType === 'reject'  ? 'bg-red-500 hover:bg-red-400 text-white' :
                                               'bg-blue-500 hover:bg-blue-400 text-white'
                }`}
              >
                {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Tasdiqlash
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Assign Trial Modal */}
      {assignModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAssignModal(false)}>
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-dark-700">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <LuClipboardList size={18} className="text-amber-400" />
                Xodimga test rejimi tayinlash
              </h2>
              <button onClick={() => setAssignModal(false)} className="text-dark-500 hover:text-dark-300">
                <LuX size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="label">Xodimni tanlang *</label>
                <select
                  value={assignForm.employee_id}
                  onChange={e => setAssignForm({ ...assignForm, employee_id: e.target.value })}
                  className="input-field"
                >
                  <option value="">Tanlang...</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.position} — {emp.branch}) {emp.status === 'trial' ? '[Hozir testda]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Sinov muddati (kun)</label>
                  <select
                    value={assignForm.days_count}
                    onChange={e => setAssignForm({ ...assignForm, days_count: parseInt(e.target.value) })}
                    className="input-field"
                  >
                    <option value={3}>3 kun</option>
                    <option value={5}>5 kun (standart)</option>
                    <option value={7}>7 kun (1 hafta)</option>
                    <option value={10}>10 kun</option>
                    <option value={14}>14 kun (2 hafta)</option>
                    <option value={30}>30 kun (1 oy)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Boshlanish sanasi</label>
                  <input
                    type="date"
                    value={assignForm.start_date}
                    onChange={e => setAssignForm({ ...assignForm, start_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 flex gap-2">
                <LuLightbulb size={16} className="text-amber-500 flex-shrink-0" />
                <span>Test rejimi tayinlangach, xodimning holati avtomatik ravishda <strong>"Test"</strong>ga o'tadi va uning hisoboti Test rejimida kuzatiladi.</span>
              </p>
            </div>

            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setAssignModal(false)} className="btn-secondary">
                Bekor qilish
              </button>
              <button
                onClick={async () => {
                  if (!assignForm.employee_id) return alert("Iltimos, xodimni tanlang")
                  setSubmitting(true)
                  try {
                    await trialFunctions.assignTrial(
                      assignForm.employee_id,
                      assignForm.days_count,
                      assignForm.start_date
                    )
                    setAssignModal(false)
                    load()
                  } catch (err) {
                    alert(err.message)
                  } finally {
                    setSubmitting(false)
                  }
                }}
                disabled={submitting || !assignForm.employee_id}
                className="btn-primary"
              >
                {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Tayinlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
