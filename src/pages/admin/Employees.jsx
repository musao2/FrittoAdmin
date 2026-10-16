import { useState, useEffect, useCallback } from 'react'
import {
  LuUsers, LuPlus, LuSearch, LuPencil, LuUserX, LuUserCheck,
  LuX, LuSave, LuCircleAlert, LuEye, LuClipboardList, LuCircleCheck,
} from 'react-icons/lu'
import {
  employeeFunctions, trialFunctions, salaryRateFunctions,
  scheduleFunctions, createSecondaryAuthClient, formatTashkentDate, formatMoney
} from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useBranch } from '../../context/BranchContext'

const STATUS_LABELS = {
  trial:    { label: 'Sinovda',     cls: 'badge-yellow' },
  active:   { label: 'Ishlayapti',  cls: 'badge-green' },
  inactive: { label: 'Bo\'shagan',  cls: 'badge-gray' },
  rejected: { label: 'Rad etilgan', cls: 'badge-gray' },
}

const BRANCHES = ['Asosiy', 'Filial 1', 'Filial 2', 'Filial 3']

const WEEK_DAYS = [
  { key: 'Mon', label: 'Du', full: 'Dushanba' },
  { key: 'Tue', label: 'Se', full: 'Seshanba' },
  { key: 'Wed', label: 'Chor', full: 'Chorshanba' },
  { key: 'Thu', label: 'Pay', full: 'Payshanba' },
  { key: 'Fri', label: 'Ju', full: 'Juma' },
  { key: 'Sat', label: 'Sha', full: 'Shanba' },
  { key: 'Sun', label: 'Yak', full: 'Yakshanba' },
]

function calculateShiftHours(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let startMinutes = sh * 60 + sm
  let endMinutes = eh * 60 + em
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60 // Yarim tundan o'tgan smena (10:00 - 00:00 = 14 soat)
  }
  const diffHours = (endMinutes - startMinutes) / 60
  return Number.isInteger(diffHours) ? diffHours : diffHours.toFixed(1)
}

const EMPTY_FORM = {
  full_name: '', phone: '', telegram_id: '', position: '',
  branch: 'Asosiy', branch_id: '', hire_date: new Date().toISOString().split('T')[0],
  hourly_rate: '',
  schedule_mode: 'different', // 'same' | 'different'
  // Du, Chor, Juma uchun:
  even_shift_start: '10:00',
  even_shift_end: '14:00',
  // Se, Pay, Shan uchun:
  odd_shift_start: '10:00',
  odd_shift_end: '',
  // Bir xil vaqt uchun:
  shift_start: '09:00',
  shift_end: '18:00',
  work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  // Ruxsat berilgan kechikish (daqiqa):
  allowed_late_minutes: 10,
  is_trial: false, trial_days: 5, notes: '', email: '', password: '',
}

export default function AdminEmployees() {
  const { matchEmployee, branches: branchList, selectedId: selectedBranchId } = useBranch()
  // Xodim filiali nomi (yangi filiallar jadvalidan, bo'lmasa eski matnli nom)
  const branchName = (emp) => branchList.find(b => b.id === emp?.branch_id)?.name || emp?.branch || '—'
  const findBranchId = (emp) =>
    emp?.branch_id || branchList.find(b => b.name.trim().toLowerCase() === (emp?.branch || '').trim().toLowerCase())?.id || ''
  const { user } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [selectedSchedule, setSelectedSchedule] = useState(null)
  const [editMode, setEditMode]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [rateHistory, setRateHistory] = useState([])
  // Ishdan bo'shatish / sinovga qo'yish / doimiy qilish oynasi
  const [action, setAction]           = useState(null) // { type: 'fire' | 'trial' | 'confirm', emp }
  const [actionReason, setActionReason] = useState('')
  const [actionDays, setActionDays]   = useState(5)
  const [actionBusy, setActionBusy]   = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await employeeFunctions.getAll({})
      setEmployees(data.filter(matchEmployee))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [matchEmployee])

  useEffect(() => { load() }, [load])

  const filtered = employees.filter(emp => !statusFilter || emp.status === statusFilter).filter(emp =>
    !search ||
    emp.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    emp.phone?.includes(search) ||
    emp.position?.toLowerCase().includes(search.toLowerCase()) ||
    emp.branch?.toLowerCase().includes(search.toLowerCase())
  )

  const openAdd = () => {
    setEditMode(false)
    // Tepada filial tanlangan bo'lsa — yangi xodim shu filialga qo'shiladi
    const preset = branchList.find(b => b.id === selectedBranchId) || branchList.find(b => b.is_active) || null
    setForm({ ...EMPTY_FORM, branch_id: preset?.id || '', branch: preset?.name || EMPTY_FORM.branch })
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (emp) => {
    setEditMode(true)
    const currentRate = emp.salary_rates?.find(r => !r.effective_to)
    const schedules   = emp.work_schedules || []

    const evenSched = schedules.find(s => s.work_days?.includes('Mon') || s.work_days?.includes('Wed') || s.work_days?.includes('Fri'))
    const oddSched  = schedules.find(s => s.work_days?.includes('Tue') || s.work_days?.includes('Thu') || s.work_days?.includes('Sat'))
    const hasDifferent = schedules.length > 1 || (evenSched && oddSched && (evenSched.id !== oddSched.id || evenSched.shift_start !== oddSched.shift_start))
    const firstSched = schedules[0]

    let lateMins = 10
    let userNotes = emp.notes || ''
    if (emp.notes) {
      try {
        const meta = JSON.parse(emp.notes)
        if (meta && typeof meta === 'object') {
          if (meta.allowed_late_minutes !== undefined) lateMins = meta.allowed_late_minutes
          if (meta.user_notes !== undefined) userNotes = meta.user_notes
        }
      } catch {
        // oddiy matn
      }
    }

    setForm({
      full_name:   emp.full_name || '',
      phone:       emp.phone || '',
      telegram_id: emp.telegram_id || '',
      position:    emp.position || '',
      branch:      emp.branch || 'Asosiy',
      branch_id:   findBranchId(emp),
      hire_date:   emp.hire_date || '',
      hourly_rate: currentRate?.hourly_rate || '',
      schedule_mode: hasDifferent ? 'different' : 'same',
      even_shift_start: evenSched?.shift_start?.slice(0, 5) || '10:00',
      even_shift_end:   evenSched?.shift_end?.slice(0, 5) || '14:00',
      odd_shift_start:  oddSched?.shift_start?.slice(0, 5) || '10:00',
      odd_shift_end:    oddSched?.shift_end?.slice(0, 5) || '',
      shift_start:      firstSched?.shift_start?.slice(0, 5) || '09:00',
      shift_end:        firstSched?.shift_end?.slice(0, 5) || '18:00',
      work_days:        firstSched?.work_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      allowed_late_minutes: lateMins,
      is_trial:    emp.status === 'trial',
      trial_days:  emp.employment_trials?.[0]?.days_count || 5,
      notes:       userNotes,
      email:       '',
      password:    '',
    })
    setSelectedEmployee(emp)
    setFormError('')
    setShowModal(true)
  }

  const openDetail = async (emp) => {
    setSelectedEmployee(emp)
    const [rates, sched] = await Promise.all([
      salaryRateFunctions.getHistory(emp.id),
      scheduleFunctions.getByEmployee(emp.id).catch(() => null),
    ])
    setRateHistory(rates)
    setSelectedSchedule(sched || emp.work_schedules || null)
    setShowDetailModal(true)
  }

  const buildSchedulesToSave = (branch) => {
    const list = []
    if (form.schedule_mode === 'different') {
      if (form.even_shift_start) {
        list.push({
          shift_start: form.even_shift_start,
          shift_end:   form.even_shift_end || '00:00',
          branch:      branch,
          work_days:   ['Mon', 'Wed', 'Fri'],
        })
      }
      if (form.odd_shift_start) {
        list.push({
          shift_start: form.odd_shift_start,
          shift_end:   form.odd_shift_end || '16:00',
          branch:      branch,
          work_days:   ['Tue', 'Thu', 'Sat'],
        })
      }
    } else {
      list.push({
        shift_start: form.shift_start || '09:00',
        shift_end:   form.shift_end || '18:00',
        branch:      branch,
        work_days:   form.work_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      })
    }
    return list
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim() || !form.position.trim() || !form.hire_date) {
      setFormError("Ism, lavozim va ishga kirish sanasi majburiy")
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const notesMetadata = JSON.stringify({
        user_notes: form.notes || '',
        allowed_late_minutes: Number(form.allowed_late_minutes) || 10,
        schedule_mode: form.schedule_mode,
      })

      const schedulesToSave = buildSchedulesToSave(form.branch)

      if (editMode) {
        await employeeFunctions.update(selectedEmployee.id, {
          full_name:   form.full_name,
          phone:       form.phone,
          telegram_id: form.telegram_id,
          position:    form.position,
          branch:      form.branch,
          branch_id:   form.branch_id || null,
          hire_date:   form.hire_date,
          status:      form.is_trial ? 'trial' : (selectedEmployee.status === 'trial' ? 'active' : selectedEmployee.status),
          notes:       notesMetadata,
        })

        // Test rejimi o'zgarishi
        if (form.is_trial && selectedEmployee.status !== 'trial') {
          await trialFunctions.assignTrial(selectedEmployee.id, form.trial_days, form.hire_date)
        } else if (!form.is_trial && selectedEmployee.status === 'trial') {
          await trialFunctions.removeTrial(selectedEmployee.id)
        }

        // Stavkani yangilash
        if (form.hourly_rate) {
          await salaryRateFunctions.set(
            selectedEmployee.id,
            parseFloat(form.hourly_rate),
            form.hire_date,
            user.id
          )
        }

        // Jadvalni yangilash
        await scheduleFunctions.upsert(selectedEmployee.id, schedulesToSave)
      } else {
        // Yangi xodim qo'shish
        if (!form.email || !form.password) {
          setFormError("Email va parol talab qilinadi")
          setSubmitting(false)
          return
        }

        // Yangi xodim uchun Auth akkaunti yaratish
        const authClient = createSecondaryAuthClient()
        const { data: signUpData, error: signUpErr } = await authClient.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { role: 'employee', full_name: form.full_name },
          }
        })

        if (signUpErr) throw signUpErr

        const newUserId = signUpData.user?.id
        const isTrial = form.is_trial
        const trialDays = parseInt(form.trial_days || 5)

        // Xodim profili yaratish
        const newEmp = await employeeFunctions.create({
          user_id:      newUserId || null,
          full_name:    form.full_name,
          phone:        form.phone,
          telegram_id:  form.telegram_id,
          position:     form.position,
          branch:       form.branch,
          branch_id:    form.branch_id || null,
          hire_date:    form.hire_date,
          status:       isTrial ? 'trial' : 'active',
          confirmed_at: isTrial ? null : new Date().toISOString(),
          notes:        notesMetadata,
        })

        // Stavka belgilash
        if (form.hourly_rate) {
          await salaryRateFunctions.set(
            newEmp.id,
            parseFloat(form.hourly_rate),
            form.hire_date,
            user.id
          )
        }

        // Jadval belgilash
        await scheduleFunctions.upsert(newEmp.id, schedulesToSave)

        // Agar admin test rejimini tanlagan bo'lsa, test rejimi yaratish
        if (isTrial) {
          await trialFunctions.assignTrial(newEmp.id, trialDays, form.hire_date)
        }
      }

      setShowModal(false)
      load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openAction = (type, emp) => {
    setShowDetailModal(false)
    setActionReason('')
    setActionDays(5)
    setActionError('')
    setAction({ type, emp })
  }

  const submitAction = async () => {
    const { type, emp } = action
    if (type === 'fire' && !actionReason.trim()) {
      setActionError("Sababni yozing yoki tanlang")
      return
    }
    setActionBusy(true)
    setActionError('')
    try {
      if (type === 'fire')    await employeeFunctions.deactivate(emp.id, actionReason.trim())
      if (type === 'trial')   await trialFunctions.assignTrial(emp.id, Number(actionDays))
      if (type === 'confirm') await trialFunctions.removeTrial(emp.id)
      setAction(null)
      load()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionBusy(false)
    }
  }


  const counts = employees.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1
    return acc
  }, {})

  const runAction = async (fn) => {
    try {
      await fn()
      setShowDetailModal(false)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Sarlavha */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Xodimlar</h1>
          <p className="page-subtitle">
            Jami {employees.length} ta xodim · {counts.active || 0} ta ishlayapti
            {counts.trial ? ` · ${counts.trial} ta sinovda` : ''}
          </p>
        </div>
        <button id="add-employee-btn" onClick={openAdd} className="btn-primary">
          <LuPlus size={16} /> Xodim qo'shish
        </button>
      </div>

      {/* Holat tablari va qidiruv */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg overflow-x-auto no-scrollbar" id="status-filter">
          {STATUS_TABS.map(tab => {
            const n = tab.id ? (counts[tab.id] || 0) : employees.length
            const active = statusFilter === tab.id
            return (
              <button
                key={tab.id || 'all'}
                onClick={() => setStatusFilter(tab.id)}
                className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tab.label}
                <span className={`text-xs ${active ? 'text-emerald-700' : 'text-slate-400'}`}>{n}</span>
              </button>
            )
          })}
        </div>

        <div className="relative lg:w-80">
          <LuSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Ism, telefon yoki lavozim..."
            className="input-field pl-9"
          />
        </div>
      </div>

      {/* Ro'yxat */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <LuUsers size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-medium text-slate-900">
            {search ? `"${search}" bo'yicha xodim topilmadi` : 'Bu bo\'limda xodim yo\'q'}
          </p>
          {!search && (
            <button onClick={openAdd} className="btn-primary mx-auto mt-4">
              <LuPlus size={16} /> Xodim qo'shish
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Kompyuter: jadval */}
          <div className="table-container hidden md:block">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-head">Xodim</th>
                  <th className="table-head">Lavozim</th>
                  <th className="table-head hidden xl:table-cell">Ish vaqti</th>
                  <th className="table-head text-right">Soatiga</th>
                  <th className="table-head">Holat</th>
                  <th className="table-head"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => {
                  const rate = emp.salary_rates?.find(r => !r.effective_to)
                  return (
                    <tr key={emp.id} className="table-row cursor-pointer" onClick={() => openDetail(emp)}>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <Avatar name={emp.full_name} />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 truncate max-w-56">{emp.full_name}</p>
                            <p className="text-xs text-slate-500">{emp.phone || 'Telefon yo\'q'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell">
                        <p className="text-slate-900">{emp.position || '—'}</p>
                        <p className="text-xs text-slate-500">{branchName(emp)}</p>
                      </td>
                      <td className="table-cell hidden xl:table-cell">
                        <ScheduleShort schedules={emp.work_schedules} />
                      </td>
                      <td className="table-cell text-right">
                        {rate ? formatMoney(rate.hourly_rate) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="table-cell"><StatusBadge emp={emp} /></td>
                      <td className="table-cell">
                        <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openDetail(emp)} className="btn-secondary h-9 px-3">
                            <LuEye size={16} /> Ko'rish
                          </button>
                          <button onClick={() => openEdit(emp)} className="btn-secondary h-9 px-3" title="Tahrirlash" aria-label="Tahrirlash">
                            <LuPencil size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Telefon: kartalar */}
          <div className="space-y-2 md:hidden">
            {filtered.map(emp => {
              const rate = emp.salary_rates?.find(r => !r.effective_to)
              return (
                <button
                  key={emp.id}
                  onClick={() => openDetail(emp)}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 hover:border-slate-300 cursor-pointer"
                >
                  <Avatar name={emp.full_name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900 truncate">{emp.full_name}</p>
                      <StatusBadge emp={emp} />
                    </div>
                    <p className="text-sm text-slate-500 truncate">
                      {emp.position || '—'}{rate ? ` · ${formatMoney(rate.hourly_rate)}/soat` : ''}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ===== QO'SHISH / TAHRIRLASH ===== */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="drawer-panel">
            <DrawerHeader
              title={editMode ? 'Xodimni tahrirlash' : 'Yangi xodim'}
              onClose={() => setShowModal(false)}
            />

            <div className="flex-1 overflow-y-auto">
              <div className="max-w-xl mx-auto p-6 space-y-8">
                {formError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <LuCircleAlert size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{formError}</p>
                  </div>
                )}

                {!editMode && (
                  <FormSection title="Tizimga kirish" hint="Xodim shu email va parol bilan o'z sahifasiga kiradi">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <InputField label="Email" value={form.email} onChange={v => setForm({...form, email: v})} type="email" placeholder="ism@fritto.uz" required />
                      <InputField label="Parol" value={form.password} onChange={v => setForm({...form, password: v})} type="password" placeholder="Kamida 6 belgi" required />
                    </div>
                  </FormSection>
                )}

                <FormSection title="Shaxsiy ma'lumot">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InputField label="Ism va familiya" value={form.full_name} onChange={v => setForm({...form, full_name: v})} placeholder="Abdullayev Azizbek" required />
                    <InputField label="Telefon" value={form.phone} onChange={v => setForm({...form, phone: v})} placeholder="+998 90 123 45 67" />
                  </div>
                </FormSection>

                <FormSection title="Ish va maosh">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InputField label="Lavozim" value={form.position} onChange={v => setForm({...form, position: v})} placeholder="Oshpaz, kassir..." required />
                    <div>
                      <label className="label">Filial</label>
                      {branchList.length > 0 ? (
                        <select
                          value={form.branch_id}
                          onChange={e => {
                            const b = branchList.find(x => x.id === e.target.value)
                            setForm({ ...form, branch_id: e.target.value, branch: b?.name || form.branch })
                          }}
                          className="input-field"
                        >
                          <option value="">Filial tanlanmagan</option>
                          {branchList.map(b => <option key={b.id} value={b.id}>{b.name}{!b.is_active && " (o'chirilgan)"}</option>)}
                        </select>
                      ) : (
                        // Filiallar hali qo'shilmagan — eski ro'yxat
                        <select value={form.branch} onChange={e => setForm({...form, branch: e.target.value})} className="input-field">
                          {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      )}
                    </div>
                    <InputField label="Ishga kirgan sana" value={form.hire_date} onChange={v => setForm({...form, hire_date: v})} type="date" required />
                    <InputField label="Bir soatlik maosh (so'm)" value={form.hourly_rate} onChange={v => setForm({...form, hourly_rate: v})} type="number" placeholder="25000" />
                  </div>
                </FormSection>

                <FormSection title="Ish vaqti">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'same', label: 'Har kuni bir xil' },
                      { id: 'different', label: 'Kunlarga qarab har xil' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setForm({ ...form, schedule_mode: opt.id })}
                        className={`h-10 rounded-lg border text-sm transition-colors cursor-pointer ${
                          form.schedule_mode === opt.id
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-medium'
                            : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {form.schedule_mode === 'different' ? (
                    <div className="space-y-3">
                      <TimeRange
                        title="Dushanba, Chorshanba, Juma"
                        start={form.even_shift_start} end={form.even_shift_end}
                        onStart={v => setForm({ ...form, even_shift_start: v })}
                        onEnd={v => setForm({ ...form, even_shift_end: v })}
                      />
                      <TimeRange
                        title="Seshanba, Payshanba, Shanba"
                        start={form.odd_shift_start} end={form.odd_shift_end}
                        onStart={v => setForm({ ...form, odd_shift_start: v })}
                        onEnd={v => setForm({ ...form, odd_shift_end: v })}
                      />
                    </div>
                  ) : (
                    <TimeRange
                      title="Barcha ish kunlari"
                      start={form.shift_start} end={form.shift_end}
                      onStart={v => setForm({ ...form, shift_start: v })}
                      onEnd={v => setForm({ ...form, shift_end: v })}
                    />
                  )}

                  <div>
                    <label className="label">Necha daqiqa kechiksa ham bo'ladi?</label>
                    <div className="relative max-w-40">
                      <input
                        type="number" min="0" max="120"
                        value={form.allowed_late_minutes}
                        onChange={e => setForm({ ...form, allowed_late_minutes: Number(e.target.value) || 0 })}
                        className="input-field pr-16"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">daqiqa</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">
                      Masalan, ish 10:00 da boshlansa va 10 daqiqa qo'yilsa: 10:10 gacha kelsa "o'z vaqtida", keyin kelsa "kechikdi".
                    </p>
                  </div>
                </FormSection>

                <FormSection title="Sinov muddati">
                  <label className="flex items-center justify-between gap-4 cursor-pointer">
                    <div>
                      <p className="text-sm text-slate-900">Avval sinab ko'rish</p>
                      <p className="text-xs text-slate-500">
                        {form.is_trial ? 'Xodim bir necha kun sinovda ishlaydi' : 'Xodim darhol doimiy ishga olinadi'}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.is_trial}
                      onChange={e => setForm({ ...form, is_trial: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="relative w-10 h-6 bg-slate-300 rounded-full flex-shrink-0 transition-colors peer-checked:bg-emerald-600 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-4" />
                  </label>

                  {form.is_trial && (
                    <div>
                      <label className="label">Necha kun?</label>
                      <select
                        value={form.trial_days}
                        onChange={e => setForm({...form, trial_days: parseInt(e.target.value)})}
                        className="input-field"
                      >
                        <option value={3}>3 kun</option>
                        <option value={5}>5 kun</option>
                        <option value={7}>7 kun (1 hafta)</option>
                        <option value={10}>10 kun</option>
                        <option value={14}>14 kun (2 hafta)</option>
                        <option value={30}>30 kun (1 oy)</option>
                      </select>
                    </div>
                  )}
                </FormSection>

                <FormSection title="Izoh">
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({...form, notes: e.target.value})}
                    placeholder="Qo'shimcha ma'lumot (shart emas)"
                    className="input-field resize-none"
                    rows={3}
                  />
                </FormSection>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex gap-2 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Bekor qilish</button>
              <button id="save-employee-btn" onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1">
                {submitting
                  ? <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                  : <LuSave size={16} />}
                {editMode ? "O'zgarishlarni saqlash" : "Xodimni qo'shish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== XODIM HAQIDA ===== */}
      {showDetailModal && selectedEmployee && (() => {
        const emp = selectedEmployee
        const scheduleList = selectedSchedule?.all || (Array.isArray(selectedSchedule) ? selectedSchedule : selectedSchedule ? [selectedSchedule] : [])
        const trial = emp.employment_trials?.[0]
        const currentRate = rateHistory.find(r => !r.effective_to) || emp.salary_rates?.find(r => !r.effective_to)
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowDetailModal(false)}>
            <div className="drawer-panel">
              <DrawerHeader title="Xodim haqida" onClose={() => setShowDetailModal(false)} />

              <div className="flex-1 overflow-y-auto">
                <div className="max-w-xl mx-auto p-6 space-y-8">
                  {/* Kim */}
                  <div className="flex items-center gap-4">
                    <Avatar name={emp.full_name} size="lg" />
                    <div className="min-w-0">
                      <p className="text-lg font-semibold text-slate-900">{emp.full_name}</p>
                      <p className="text-sm text-slate-500">{emp.position} · {branchName(emp)}</p>
                      <div className="mt-1.5"><StatusBadge emp={emp} /></div>
                    </div>
                  </div>

                  {trial?.status === 'in_progress' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                      Sinov muddatida: {trialFunctions.getTrialDay(trial.trial_start_date)}-kun / {trial.days_count || 5} kun
                    </div>
                  )}

                  {/* Ma'lumotlar */}
                  <FormSection title="Ma'lumotlar">
                    <dl className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                      <InfoRow label="Telefon" value={emp.phone || '—'} />
                      <InfoRow label="Ishga kirgan" value={formatTashkentDate(emp.hire_date)} />
                      <InfoRow label="Doimiy qilingan" value={emp.confirmed_at ? formatTashkentDate(emp.confirmed_at) : '—'} />
                      <InfoRow label="Bir soatlik maosh" value={currentRate ? formatMoney(currentRate.hourly_rate) : '—'} />
                    </dl>
                  </FormSection>

                  {/* Ish vaqti */}
                  {scheduleList.length > 0 && (
                    <FormSection title="Ish vaqti">
                      <div className="grid grid-cols-7 gap-1.5">
                        {WEEK_DAYS.map(day => {
                          const s = scheduleList.find(x => (x.work_days || []).includes(day.key))
                          return (
                            <div
                              key={day.key}
                              title={day.full}
                              className={`rounded-lg py-2 text-center ${s ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400'}`}
                            >
                              <p className="text-xs font-medium">{day.label}</p>
                              <p className="text-xs mt-0.5">{s ? s.shift_start?.slice(0, 5) : 'Dam'}</p>
                            </div>
                          )
                        })}
                      </div>
                      <div className="space-y-2">
                        {scheduleList.map((s, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-3 text-sm border border-slate-200 rounded-lg px-4 py-3">
                            <div className="min-w-0">
                              <p className="text-slate-900 font-medium">{s.shift_start?.slice(0, 5)} — {s.shift_end?.slice(0, 5)}</p>
                              <p className="text-xs text-slate-500">
                                {WEEK_DAYS.filter(d => (s.work_days || []).includes(d.key)).map(d => d.full).join(', ')}
                              </p>
                            </div>
                            <p className="text-slate-500 whitespace-nowrap">{calculateShiftHours(s.shift_start, s.shift_end)} soat</p>
                          </div>
                        ))}
                      </div>
                    </FormSection>
                  )}

                  {/* Maosh tarixi */}
                  {rateHistory.length > 1 && (
                    <FormSection title="Maosh o'zgarishlari">
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {rateHistory.map(rate => (
                          <div key={rate.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                            <span className="text-slate-900 font-medium">{formatMoney(rate.hourly_rate)} / soat</span>
                            <span className="text-slate-500 text-right">
                              {formatTashkentDate(rate.effective_from)}
                              {rate.effective_to ? ` — ${formatTashkentDate(rate.effective_to)}` : ' — hozirgacha'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </FormSection>
                  )}
                </div>
              </div>

              {/* Amallar */}
              <div className="px-6 py-4 border-t border-slate-200 flex flex-wrap gap-2 flex-shrink-0">
                <button onClick={() => { setShowDetailModal(false); openEdit(emp) }} className="btn-primary flex-1">
                  <LuPencil size={16} /> Tahrirlash
                </button>
                {emp.status === 'trial' && (
                  <button
                    onClick={() => openAction('confirm', emp)}
                    className="btn-secondary flex-1"
                  >
                    <LuCircleCheck size={16} /> Doimiy ishga olish
                  </button>
                )}
                {emp.status === 'active' && (
                  <button
                    onClick={() => openAction('trial', emp)}
                    className="btn-secondary flex-1"
                  >
                    <LuClipboardList size={16} /> Sinovga qo'yish
                  </button>
                )}
                {emp.status === 'active' && (
                  <button onClick={() => openAction('fire', emp)} className="btn-danger flex-1">
                    <LuUserX size={16} /> Ishdan bo'shatish
                  </button>
                )}
                {emp.status === 'inactive' && (
                  <button onClick={() => runAction(() => employeeFunctions.activate(emp.id))} className="btn-secondary flex-1">
                    <LuUserCheck size={16} /> Qayta ishga olish
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ===== ISHDAN BO'SHATISH / SINOV / DOIMIY QILISH ===== */}
      {action && (() => {
        const { type, emp } = action
        const cfg = {
          fire:    { title: "Ishdan bo'shatish", btn: "Ishdan bo'shatish", btnCls: 'btn-danger bg-red-600 text-white border-red-600 hover:bg-red-700' },
          trial:   { title: "Sinovga qo'yish",   btn: "Sinovga qo'yish",   btnCls: 'btn-primary' },
          confirm: { title: 'Doimiy ishga olish', btn: 'Ha, doimiy ishga olish', btnCls: 'btn-primary' },
        }[type]
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !actionBusy && setAction(null)}>
            <div className="drawer-panel">
              <DrawerHeader title={cfg.title} onClose={() => !actionBusy && setAction(null)} />

              <div className="flex-1 overflow-y-auto">
                <div className="max-w-xl mx-auto p-6 space-y-6">
                  <div className="flex items-center gap-4">
                    <Avatar name={emp.full_name} size="lg" />
                    <div className="min-w-0">
                      <p className="text-lg font-semibold text-slate-900">{emp.full_name}</p>
                      <p className="text-sm text-slate-500">{emp.position} · {branchName(emp)}</p>
                    </div>
                  </div>

                  {actionError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <LuCircleAlert size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{actionError}</p>
                    </div>
                  )}

                  {type === 'fire' && (
                    <>
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                        Xodimning holati "Bo'shagan" bo'ladi va sabab saqlanadi. Keyinchalik "Qayta ishga olish" tugmasi bilan qaytarish mumkin.
                      </div>
                      <div>
                        <label className="label">Nima sababdan?</label>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {FIRE_REASONS.map(r => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setActionReason(r)}
                              className={`px-3 h-9 rounded-lg border text-sm transition-colors cursor-pointer ${
                                actionReason === r
                                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-medium'
                                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={actionReason}
                          onChange={e => setActionReason(e.target.value)}
                          placeholder="Yoki sababni o'zingiz yozing..."
                          className="input-field resize-none"
                          rows={3}
                          autoFocus
                        />
                      </div>
                    </>
                  )}

                  {type === 'trial' && (
                    <div>
                      <label className="label">Necha kun sinovda bo'ladi?</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[3, 5, 7, 10, 14, 30].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setActionDays(d)}
                            className={`h-12 rounded-lg border text-sm transition-colors cursor-pointer ${
                              actionDays === d
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-medium'
                                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {d} kun
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {type === 'confirm' && (
                    <p className="text-sm text-slate-700">
                      Xodim sinovdan o'tdi deb belgilanadi va doimiy ishga olinadi. Holati "Ishlayapti" bo'ladi.
                    </p>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex gap-2 flex-shrink-0">
                <button onClick={() => setAction(null)} disabled={actionBusy} className="btn-secondary">Bekor qilish</button>
                <button onClick={submitAction} disabled={actionBusy} className={`${cfg.btnCls} flex-1`}>
                  {actionBusy && <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />}
                  {cfg.btn}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

const FIRE_REASONS = [
  "O'z xohishi bilan",
  'Ishga kelmay qoldi',
  'Intizom buzilishi',
  "Sinovdan o'tmadi",
]

const STATUS_TABS = [
  { id: '',         label: 'Hammasi' },
  { id: 'active',   label: 'Ishlayapti' },
  { id: 'trial',    label: 'Sinovda' },
  { id: 'inactive', label: 'Bo\'shagan' },
  { id: 'rejected', label: 'Rad etilgan' },
]

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
}

function Avatar({ name, size = 'md' }) {
  const cls = size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm'
  return (
    <div className={`${cls} rounded-full bg-emerald-50 text-emerald-700 font-semibold flex items-center justify-center flex-shrink-0`}>
      {initials(name)}
    </div>
  )
}

function StatusBadge({ emp }) {
  const s = STATUS_LABELS[emp.status] || STATUS_LABELS.active
  return <span className={s.cls}>{s.label}</span>
}

function ScheduleShort({ schedules }) {
  const list = schedules || []
  if (!list.length) return <span className="text-slate-400">—</span>
  return (
    <div className="space-y-1">
      <p className="text-slate-900">
        {list[0].shift_start?.slice(0, 5)} — {list[0].shift_end?.slice(0, 5)}
        {list.length > 1 && <span className="text-xs text-slate-400"> +{list.length - 1}</span>}
      </p>
      <div className="flex gap-0.5">
        {WEEK_DAYS.map(d => {
          const on = list.some(s => (s.work_days || []).includes(d.key))
          return (
            <span
              key={d.key}
              title={`${d.full}: ${on ? 'ish kuni' : 'dam olish'}`}
              className={`w-5 h-5 rounded text-[10px] flex items-center justify-center ${on ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-300'}`}
            >
              {d.label[0]}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function DrawerHeader({ title, onClose }) {
  return (
    <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish">
        <LuX size={20} />
      </button>
    </div>
  )
}

function FormSection({ title, hint, children }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function TimeRange({ title, start, end, onStart, onEnd }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 space-y-3">
      <p className="text-sm text-slate-700">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Keladi</label>
          <input type="time" value={start} onChange={e => onStart(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Ketadi</label>
          <input type="time" value={end} onChange={e => onEnd(e.target.value)} className="input-field" />
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 text-right">{value}</dd>
    </div>
  )
}

function InputField({ label, value, onChange, type = 'text', placeholder, required }) {
  return (
    <div>
      <label className="label">{label}{required && ' *'}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field"
        required={required}
      />
    </div>
  )
}
