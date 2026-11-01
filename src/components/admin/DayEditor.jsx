import { useState } from 'react'
import { LuX, LuPlus, LuTrash2, LuArrowRight, LuCircleAlert, LuRotateCcw } from 'react-icons/lu'
import { supabase, attendanceFunctions, payrollFunctions, formatMoney } from '../../lib/supabase'

const TZ = 'Asia/Tashkent'
const MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']
const WEEKDAYS = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba']
const pad = (n) => String(n).padStart(2, '0')

// ISO → "HH:MM" (Toshkent vaqti)
const hhmm = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  : ''
// "2026-11-01" + "14:38" → Toshkent vaqtidagi Date
const at = (dayKey, time) => new Date(`${dayKey}T${time}:00+05:00`)
const dur = (s) => `${Math.floor(s / 3600)} soat ${Math.floor((s % 3600) / 60)} daq`

/**
 * Bir kunning kelib-ketishlarini tahrirlash (faqat admin):
 * vaqtni o'zgartirish, ketishni belgilamaganini yopish, qo'shish, o'chirish.
 */
export default function DayEditor({ day, employee, adminId, onClose, onSaved }) {
  const rate = employee?.salary_rates?.find(r => !r.effective_to)
  const monthly = rate?.salary_type === 'monthly'
  const currentHourly = monthly ? 0 : Number(rate?.hourly_rate) || 0

  const [rows, setRows] = useState(() => day.list.map(s => ({
    id: s.id,
    in: hhmm(s.check_in_at),
    out: hhmm(s.check_out_at),
    wasOpen: s.status === 'open',
    snapshot: Number(s.hourly_rate_snapshot) || 0,
    orig: { in: hhmm(s.check_in_at), out: hhmm(s.check_out_at) },
    deleted: false,
  })))
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')

  const update = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows(rs => [...rs, { id: null, in: '09:00', out: '18:00', wasOpen: false, snapshot: 0, orig: null, deleted: false }])

  // Ketish vaqti kelishdan oldin bo'lsa — keyingi kun (tungi smena)
  const calc = (r) => {
    if (!r.in) return null
    const inAt = at(day.key, r.in)
    let outAt = r.out ? at(day.key, r.out) : null
    if (outAt && outAt <= inAt) outAt = new Date(outAt.getTime() + 24 * 3600 * 1000)
    const secs = outAt ? Math.round((outAt - inAt) / 1000) : 0
    // Eski yozuvda maosh yozilmagan bo'lsa (0) — hozirgi soatlik maosh bilan hisoblaymiz
    const hourly = r.snapshot > 0 ? r.snapshot : currentHourly
    return { inAt, outAt, secs, hourly, earned: outAt ? Math.round(secs / 3600 * hourly) : 0 }
  }

  const changed = (r) => r.deleted || !r.id || r.in !== r.orig.in || r.out !== r.orig.out
  const anyChange = rows.some(r => (r.id || !r.deleted) && changed(r))

  const save = async () => {
    setError('')
    const live = rows.filter(r => !r.deleted)
    for (const r of live) {
      if (!r.in) return setError('Kelgan vaqtni kiriting')
      const c = calc(r)
      if (c.secs > 20 * 3600) return setError(`${r.in}–${r.out}: 20 soatdan ko'p bo'lishi mumkin emas. Vaqtni tekshiring.`)
    }
    if (live.filter(r => !r.out).length > 1) return setError("Faqat bitta yozuv «hali ishda» bo'lishi mumkin")
    if (!reason.trim()) return setError('Nima uchun tuzatilayotganini yozing (masalan: ketishni belgilamagan)')

    setBusy(true)
    try {
      for (const r of rows) {
        if (!changed(r)) continue
        // O'chirish
        if (r.deleted) {
          if (!r.id) continue
          const { error } = await supabase.from('attendance_sessions').delete().eq('id', r.id)
          if (error) throw error
          await supabase.from('audit_logs').insert({
            table_name: 'attendance_sessions', record_id: r.id, action: 'admin_delete',
            reason, performed_by: adminId,
          })
          continue
        }
        const c = calc(r)
        const fields = {
          check_in_at: c.inAt.toISOString(),
          check_out_at: c.outAt ? c.outAt.toISOString() : null,
          worked_seconds: c.secs,
          earned_amount: c.earned,
          hourly_rate_snapshot: c.hourly,
          status: c.outAt ? 'corrected' : 'open',
        }
        if (r.id) {
          await attendanceFunctions.adminCorrect(r.id, fields, reason, adminId)
        } else {
          const { error } = await supabase.from('attendance_sessions').insert({
            employee_id: employee.id, ...fields,
            admin_corrected: true, correction_reason: reason,
            corrected_by: adminId, corrected_at: new Date().toISOString(),
          })
          if (error) throw error
        }
      }

      // Oylik hisobini yangilaymiz
      const [y, m] = day.key.split('-').map(Number)
      try {
        const period = await payrollFunctions.getOrCreatePeriod(y, m)
        const last = new Date(y, m, 0).getDate()
        await payrollFunctions.calculateForEmployee(employee.id, period.id, `${y}-${pad(m)}-01T00:00:00`, `${y}-${pad(m)}-${last}T23:59:59`)
      } catch (e) {
        console.warn('Oylikni qayta hisoblashda xato:', e)
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const [y, m, d] = day.key.split('-').map(Number)
  const title = `${d}-${MONTHS[m - 1]}, ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer-panel">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Kunni tahrirlash</h2>
            <p className="text-xs text-slate-500 truncate">{employee?.full_name} · {title}</p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish">
            <LuX size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-md mx-auto p-6 space-y-4">
            {rows.length === 0 && (
              <p className="text-sm text-slate-500">Bu kuni kelib-ketish yo'q. Kelgan bo'lsa — pastdan qo'shing.</p>
            )}

            {rows.map((r, i) => {
              const c = calc(r)
              return (
                <div key={r.id || `new-${i}`} className={`border rounded-xl p-4 space-y-3 ${r.deleted ? 'border-red-200 bg-red-50/50 opacity-70' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-900">
                      {r.id ? `${i + 1}-kelish` : 'Yangi'}
                      {r.wasOpen && !r.deleted && <span className="badge-blue ml-2">ketishni belgilamagan</span>}
                    </p>
                    {r.deleted ? (
                      <button onClick={() => update(i, { deleted: false })} className="text-xs text-slate-600 inline-flex items-center gap-1 cursor-pointer">
                        <LuRotateCcw size={13} /> Qaytarish
                      </button>
                    ) : (
                      <button
                        onClick={() => (r.id ? update(i, { deleted: true }) : setRows(rs => rs.filter((_, j) => j !== i)))}
                        className="text-xs text-red-600 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <LuTrash2 size={13} /> O'chirish
                      </button>
                    )}
                  </div>

                  {!r.deleted && (
                    <>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-slate-500 mb-1 block">Keldi</label>
                          <input type="time" value={r.in} onChange={e => update(i, { in: e.target.value })} className="input-field" />
                        </div>
                        <LuArrowRight size={16} className="text-slate-400 mb-3" />
                        <div className="flex-1">
                          <label className="text-xs text-slate-500 mb-1 block">Ketdi</label>
                          <input type="time" value={r.out} onChange={e => update(i, { out: e.target.value })} className="input-field" />
                        </div>
                      </div>
                      {!r.out && (
                        <p className="text-xs text-amber-700">Ketish vaqti bo'sh — «hali ishda» bo'lib qoladi. Ketgan vaqtini yozing.</p>
                      )}
                      {c?.outAt && (
                        <p className="text-xs text-slate-500">
                          Ishladi: <b className="text-slate-900">{dur(c.secs)}</b>
                          {!monthly && <> · Topdi: <b className="text-slate-900">{formatMoney(c.earned)}</b></>}
                          {r.out <= r.in && ' · keyingi kuni ketgan'}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })}

            <button onClick={addRow} className="btn-secondary w-full">
              <LuPlus size={16} /> Kelib-ketish qo'shish
            </button>

            <div>
              <label className="label">Sabab *</label>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="input-field"
                placeholder="Masalan: ketishni belgilamagan, telefoni o'chgan"
              />
              <p className="text-xs text-slate-400 mt-1">Tuzatish jurnalga yoziladi va davomatda «admin tuzatgan» deb ko'rinadi.</p>
            </div>

            {error && (
              <p className="text-sm text-red-600 flex gap-1.5"><LuCircleAlert size={16} className="flex-shrink-0 mt-0.5" /> {error}</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary">Bekor qilish</button>
          <button onClick={save} disabled={busy || !anyChange} className="btn-primary flex-1">
            {busy ? 'Saqlanmoqda...' : 'Saqlash'}
          </button>
        </div>
      </div>
    </div>
  )
}
