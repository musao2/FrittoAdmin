import { useEffect, useState, useCallback } from 'react'
import { LuSmartphone, LuCheck, LuX, LuShieldCheck, LuBan } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const TZ = 'Asia/Tashkent'
const TABS = [
  { id: 'pending',  label: 'Kutilmoqda' },
  { id: 'approved', label: 'Tasdiqlangan' },
  { id: 'rejected', label: 'Rad etilgan' },
]

const when = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d) / 60000)
  if (mins < 1) return 'hozirgina'
  if (mins < 60) return `${mins} daqiqa oldin`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} soat oldin`
  return d.toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdminDevices() {
  const { user } = useAuth()
  const [tab, setTab]         = useState('pending')
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(null)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_devices')
      .select('*, employees(full_name, position, branch)')
      .order('requested_at', { ascending: false })
    if (error) {
      setError(error.code === '42P01' || error.message?.includes('employee_devices')
        ? "Supabase'da 005_device_approval.sql fayli hali ishga tushirilmagan."
        : error.message)
    } else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  const decide = async (row, status) => {
    setBusy(row.id)
    const { error } = await supabase
      .from('employee_devices')
      .update({ status, decided_at: new Date().toISOString(), decided_by: user.id })
      .eq('id', row.id)
    setBusy(null)
    if (error) return alert(error.message)
    load()
  }

  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {})
  const list = rows.filter(r => r.status === tab)

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title">Kirish so'rovlari</h1>
        <p className="page-subtitle">Xodim yangi telefon yoki brauzerdan kirsa, shu yerda tasdiqlaysiz</p>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg w-fit overflow-x-auto no-scrollbar">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
              tab === t.id ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
            <span className={`text-xs ${t.id === 'pending' && counts.pending ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
              {counts[t.id] || 0}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-white border border-slate-200 rounded-xl animate-pulse" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="card text-center py-12">
          <LuShieldCheck size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-medium text-slate-900">
            {tab === 'pending' ? "Hozircha yangi so'rov yo'q" : "Bu ro'yxat bo'sh"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(r => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
                  <LuSmartphone size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{r.employees?.full_name || 'Noma\'lum xodim'}</p>
                  <p className="text-sm text-slate-600 truncate">{r.device_label || 'Noma\'lum qurilma'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    So'radi: {when(r.requested_at)}
                    {r.status !== 'pending' && <> · Oxirgi kirish: {when(r.last_seen_at)}</>}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 sm:flex-shrink-0">
                {r.status === 'pending' && (
                  <>
                    <button onClick={() => decide(r, 'rejected')} disabled={busy === r.id} className="btn-secondary flex-1 sm:flex-none">
                      <LuX size={16} /> Rad etish
                    </button>
                    <button onClick={() => decide(r, 'approved')} disabled={busy === r.id} className="btn-primary flex-1 sm:flex-none">
                      <LuCheck size={16} /> Tasdiqlash
                    </button>
                  </>
                )}
                {r.status === 'approved' && (
                  <button
                    onClick={() => window.confirm(`${r.employees?.full_name} bu qurilmadan endi kira olmaydi. Davom etasizmi?`) && decide(r, 'rejected')}
                    disabled={busy === r.id}
                    className="btn-danger"
                  >
                    <LuBan size={16} /> Ruxsatni olib qo'yish
                  </button>
                )}
                {r.status === 'rejected' && (
                  <button onClick={() => decide(r, 'approved')} disabled={busy === r.id} className="btn-secondary">
                    <LuCheck size={16} /> Ruxsat berish
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
