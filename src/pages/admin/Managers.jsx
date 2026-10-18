import { useEffect, useState, useCallback } from 'react'
import { LuUserPlus, LuBanknote, LuHandCoins, LuDollarSign, LuHistory } from 'react-icons/lu'
import { LuUserCog, LuPlus, LuX, LuCopy, LuCheck, LuEye, LuKeyRound, LuTrash2, LuWandSparkles, LuCircleAlert, LuExternalLink } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { PasswordInput, credentialError, CREDENTIAL_ERRORS } from '../../components/admin/AdminAccountSettings'
import { generatePassword } from '../../components/admin/EmployeeAccess'

const TZ = 'Asia/Tashkent'
const fmt = (iso) => iso
  ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'hali kirmagan'

const MANAGER_URL = import.meta.env.VITE_MANAGER_APP_URL || 'https://fritto-manager.vercel.app'

// Admin menejerga nimalarga ruxsat berishini tanlaydi
export const PERMISSIONS = [
  { key: 'add_employees',   label: "Xodim qo'shish",      hint: "Yangi xodim va uning login/parolini yaratadi" },
  { key: 'pay_salary',      label: 'Oylik berish',         hint: "Xodimga pul beradi — kim bergani sizga ko'rinadi" },
  { key: 'give_advance',    label: 'Avans berish',         hint: "Xodimga avans beradi — kim bergani sizga ko'rinadi" },
  { key: 'view_salary',     label: "Oylikni ko'rish",      hint: 'Kim qancha oylik olishini ko\'radi' },
  { key: 'view_attendance', label: "Davomatni ko'rish",    hint: 'Kim qachon kelib-ketganini ko\'radi' },
]
const DEFAULT_PERMS = { add_employees: true, pay_salary: false, give_advance: false, view_salary: true, view_attendance: true }

function PermissionPicker({ value, onChange }) {
  return (
    <div>
      <label className="label">Nimalarga ruxsat beriladi</label>
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        {PERMISSIONS.map(p => (
          <label key={p.key} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={!!value[p.key]}
              onChange={e => onChange({ ...value, [p.key]: e.target.checked })}
              className="w-4 h-4 mt-0.5 accent-[#FCA914]"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">{p.label}</span>
              <span className="block text-xs text-slate-500">{p.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

const managerError = (error) => {
  const msg = error?.message || ''
  if (error?.code === 'PGRST202' || msg.includes('Could not find the function')) {
    return "Supabase'da 016_admin_manages_managers.sql hali ishga tushirilmagan"
  }
  if (msg.includes('NOT_MANAGER')) return 'Bu foydalanuvchi menejer emas'
  if (msg.includes('admin_set_manager_permissions') || msg.includes('p_permissions')) {
    return "Supabase'da 018_manager_permissions_pay.sql hali ishga tushirilmagan"
  }
  return credentialError(error)
}

// Admin: menejer hisoblarini yaratish va boshqarish
export default function AdminManagers() {
  const [list, setList]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_managers')
    if (error) setError(managerError(error))
    else { setError(''); setList(data || []) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <LuUserCog size={20} className="text-emerald-700" />
            Menejerlar
          </h1>
          <p className="page-subtitle">
            Har bir menejerga nimaga ruxsat berishni o'zingiz tanlaysiz. Menejer bergan oyliklar "To'lovlar tarixi"da ko'rinadi.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-primary">
          <LuPlus size={16} /> Menejer qo'shish
        </button>
      </div>

      <a href={MANAGER_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline">
        Menejer paneli: {MANAGER_URL.replace(/^https?:\/\//, '')} <LuExternalLink size={14} />
      </a>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex gap-2">
          <LuCircleAlert size={18} className="flex-shrink-0 mt-0.5" /> {error}
        </div>
      ) : loading ? (
        <div className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : list.length === 0 ? (
        <div className="card text-center py-12">
          <LuUserCog size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-medium text-slate-900">Hali menejer yo'q</p>
          <p className="text-sm text-slate-500 mt-1">"Menejer qo'shish" tugmasini bosing</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-head">Ism</th>
                <th className="table-head">Email</th>
                <th className="table-head hidden md:table-cell">Ruxsatlar</th>
                <th className="table-head">Oxirgi kirgan</th>
                <th className="table-head text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {list.map(m => (
                <tr key={m.id} className="table-row">
                  <td className="table-cell font-medium text-slate-900">{m.full_name}</td>
                  <td className="table-cell">{m.email}</td>
                  <td className="table-cell hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {m.permissions
                        ? PERMISSIONS.filter(p => m.permissions[p.key]).map(p => <span key={p.key} className="badge-gray">{p.label}</span>)
                        : <span className="text-xs text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="table-cell text-slate-500">{fmt(m.last_sign_in_at)}</td>
                  <td className="table-cell text-right">
                    <button onClick={() => setEditing(m)} className="btn-secondary h-8 px-3 text-sm">
                      <LuKeyRound size={14} /> Sozlash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ManagerActivity />

      {adding && <AddManager onClose={() => setAdding(false)} onDone={load} />}
      {editing && <EditManager manager={editing} onClose={() => setEditing(null)} onDone={load} />}
    </div>
  )
}

function Drawer({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish"><LuX size={20} /></button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function CopyLine({ label, value }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* */ }
  }
  return (
    <div className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="font-mono text-slate-900 truncate">{value}</p>
      </div>
      <button onClick={copy} className="text-slate-500 hover:text-slate-900 cursor-pointer" aria-label="Nusxalash">
        {copied ? <LuCheck size={18} className="text-green-600" /> : <LuCopy size={18} />}
      </button>
    </div>
  )
}

function AddManager({ onClose, onDone }) {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState(generatePassword)
  const [show, setShow]         = useState(true)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [created, setCreated]   = useState(null)
  const [perms, setPerms]       = useState(DEFAULT_PERMS)

  const save = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('Ismini yozing')
    if (password.length < 6) return setError(CREDENTIAL_ERRORS.PASSWORD_TOO_SHORT)
    setBusy(true)
    const args = { p_email: email.trim(), p_password: password, p_full_name: name.trim(), p_permissions: perms }
    let { error } = await supabase.rpc('admin_create_manager_v2', args)
    // 019 hali ishga tushmagan bo'lsa — eski funksiya
    if (error?.code === 'PGRST202') ({ error } = await supabase.rpc('admin_create_manager', args))
    setBusy(false)
    if (error) return setError(managerError(error))
    setCreated({ email: email.trim().toLowerCase(), password })
    onDone()
  }

  if (created) {
    return (
      <Drawer title="Menejer yaratildi" onClose={onClose}>
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 flex gap-2">
          <LuCheck size={18} className="flex-shrink-0 mt-0.5" />
          Shu ma'lumotlarni menejerga bering. U menejer paneliga shular bilan kiradi.
        </div>
        <CopyLine label="Sayt" value={MANAGER_URL} />
        <CopyLine label="Email" value={created.email} />
        <CopyLine label="Parol" value={created.password} />
        <button onClick={onClose} className="btn-primary w-full">Tayyor</button>
      </Drawer>
    )
  }

  return (
    <Drawer title="Yangi menejer" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label">Ismi</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input-field" placeholder="Masalan: Aziz Karimov" autoFocus />
        </div>
        <div>
          <label className="label">Email (login)</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="menejer@fritto.uz" required autoComplete="off" />
        </div>
        <div>
          <PasswordInput label="Parol" value={password} onChange={setPassword} show={show} setShow={setShow} />
          <button type="button" onClick={() => { setPassword(generatePassword()); setShow(true) }} className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline cursor-pointer">
            <LuWandSparkles size={14} /> Yangi parol yaratish
          </button>
        </div>
        <PermissionPicker value={perms} onChange={setPerms} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Yaratilmoqda...' : 'Menejer yaratish'}
        </button>
      </form>
    </Drawer>
  )
}

function EditManager({ manager, onClose, onDone }) {
  const [email, setEmail]       = useState(manager.email || '')
  const [password, setPassword] = useState('')
  const [show, setShow]         = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState('')
  const [revealed, setRevealed] = useState(undefined)
  const [confirmDel, setConfirmDel] = useState(false)
  const [perms, setPerms]       = useState({ ...DEFAULT_PERMS, ...manager.permissions })
  const [permBusy, setPermBusy] = useState(false)
  const [permMsg, setPermMsg]   = useState('')

  const savePerms = async () => {
    setPermBusy(true); setPermMsg(''); setError('')
    const { error } = await supabase.rpc('admin_set_manager_permissions', { p_user_id: manager.id, p_permissions: perms })
    setPermBusy(false)
    if (error) return setError(managerError(error))
    setPermMsg('Ruxsatlar saqlandi. Menejer sahifani yangilasa kuchga kiradi.')
    onDone()
  }

  const reveal = async () => {
    setError('')
    const { data, error } = await supabase.rpc('admin_reveal_manager_password', { p_user_id: manager.id })
    if (error) setError(managerError(error))
    else setRevealed(data)
  }

  const save = async (e) => {
    e.preventDefault()
    setError(''); setDone('')
    if (password && password.length < 6) return setError(CREDENTIAL_ERRORS.PASSWORD_TOO_SHORT)
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_set_manager_credentials', {
      p_user_id: manager.id, p_email: email.trim(), p_password: password || null,
    })
    setBusy(false)
    if (error) return setError(managerError(error))
    if (!data?.email_changed && !data?.password_changed) return setDone("Hech narsa o'zgarmadi")
    setDone('Saqlandi' + (data.password_changed ? '. Menejer yangi parol bilan qayta kirishi kerak.' : ''))
    if (data.password_changed) setRevealed(password)
    setPassword('')
    onDone()
  }

  const remove = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('admin_delete_manager', { p_user_id: manager.id })
    setBusy(false)
    if (error) return setError(managerError(error))
    onDone()
    onClose()
  }

  return (
    <Drawer title={manager.full_name} onClose={onClose}>
      <PermissionPicker value={perms} onChange={(v) => { setPerms(v); setPermMsg('') }} />
      {permMsg && <p className="text-sm text-green-700">{permMsg}</p>}
      <button onClick={savePerms} disabled={permBusy} className="btn-primary w-full">
        {permBusy ? 'Saqlanmoqda...' : 'Ruxsatlarni saqlash'}
      </button>

      <h3 className="text-sm font-semibold text-slate-900 pt-4 border-t border-slate-200">Kirish ma'lumotlari</h3>
      <div className="border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Hozirgi parol</p>
          <p className="font-mono text-slate-900 truncate">
            {revealed === undefined ? '••••••••' : revealed === null ? <span className="font-sans text-sm text-slate-500">Nusxa yo'q — pastda yangi parol qo'ying</span> : revealed}
          </p>
        </div>
        {revealed === undefined && (
          <button onClick={reveal} className="btn-secondary h-8 px-3 text-sm"><LuEye size={14} /> Ko'rsatish</button>
        )}
      </div>

      <form onSubmit={save} className="space-y-4 pt-2">
        <div>
          <label className="label">Email (login)</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" required />
        </div>
        <div>
          <PasswordInput label="Yangi parol (o'zgartirmasangiz bo'sh qoldiring)" value={password} onChange={setPassword} show={show} setShow={setShow} />
          <button type="button" onClick={() => { setPassword(generatePassword()); setShow(true) }} className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline cursor-pointer">
            <LuWandSparkles size={14} /> Yangi parol yaratish
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && <p className="text-sm text-green-700">{done}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Saqlanmoqda...' : 'Saqlash'}</button>
      </form>

      <div className="border-t border-slate-200 pt-4">
        {confirmDel ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
            <p className="text-sm text-red-800">{manager.full_name} menejer panelga boshqa kira olmaydi. O'chirilsinmi?</p>
            <div className="flex gap-2">
              <button onClick={remove} disabled={busy} className="btn-danger flex-1">Ha, o'chirish</button>
              <button onClick={() => setConfirmDel(false)} className="btn-secondary flex-1">Yo'q</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:underline cursor-pointer">
            <LuTrash2 size={14} /> Menejerni o'chirish
          </button>
        )}
      </div>
    </Drawer>
  )
}

const ACTIVITY = {
  manager_employee_added: { icon: LuUserPlus,  label: "Xodim qo'shdi" },
  manager_rate_set:       { icon: LuDollarSign, label: 'Maosh belgiladi' },
  manager_payment:        { icon: LuBanknote,  label: 'Oylik berdi' },
  manager_advance:        { icon: LuHandCoins, label: 'Avans berdi' },
}

// Menejerlar nima qilgani: xodim qo'shish, oylik va avans berish
function ManagerActivity() {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    supabase
      .from('notifications')
      .select('id, type, title, message, created_at')
      .in('type', Object.keys(ACTIVITY))
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setRows(data || []))
  }, [])

  const list = (rows || []).filter(r => filter === 'all' || r.type === filter)

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-slate-100">
        <h2 className="section-title flex items-center gap-2">
          <LuHistory size={18} className="text-emerald-700" /> Menejerlar nima qildi
        </h2>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="input-field w-auto h-9 text-sm">
          <option value="all">Hammasi</option>
          {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {rows === null ? (
        <div className="h-32 animate-pulse bg-slate-50" />
      ) : list.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">Hali hech narsa qilinmagan</p>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {list.map(r => {
            const { icon: Icon, label } = ACTIVITY[r.type]
            return (
              <div key={r.id} className="flex items-start gap-3 px-5 py-3">
                <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <Icon size={15} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{label}</p>
                  <p className="text-sm text-slate-600 break-words">{r.message}</p>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap">{fmt(r.created_at)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
