import { useState } from 'react'
import { LuUserCog, LuEye, LuEyeOff, LuCircleAlert, LuCheck, LuSave } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export const CREDENTIAL_ERRORS = {
  WRONG_PASSWORD: "Joriy parol noto'g'ri",
  PASSWORD_TOO_SHORT: "Yangi parol kamida 6 ta belgidan iborat bo'lishi kerak",
  BAD_EMAIL: "Email noto'g'ri yozilgan",
  EMAIL_TAKEN: 'Bu email boshqa foydalanuvchida bor',
  NOT_EMPLOYEE: "Bu foydalanuvchi xodim emas",
  ADMIN_ONLY: "Buni faqat admin qila oladi",
  USER_NOT_FOUND: 'Foydalanuvchi topilmadi',
}

export const credentialError = (error) => {
  const msg = error?.message || ''
  if (error?.code === 'PGRST202' || msg.includes('Could not find the function')) {
    return "Supabase'da 012_account_credentials.sql fayli hali ishga tushirilmagan"
  }
  const code = Object.keys(CREDENTIAL_ERRORS).find(c => msg.includes(c))
  return code ? CREDENTIAL_ERRORS[code] : msg
}

// Sozlamalar → "Mening hisobim": admin o'z email va parolini o'zgartiradi
export default function AdminAccountSettings() {
  const { user, profile } = useAuth()
  const currentEmail = profile?.email || user?.email || ''
  const [email, setEmail]       = useState(currentEmail)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat]     = useState('')
  const [current, setCurrent]   = useState('')
  const [show, setShow]         = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState('')

  const emailChanged = email.trim().toLowerCase() !== currentEmail.toLowerCase()
  const mismatch = password && repeat && password !== repeat
  const canSave = (emailChanged || password) && current && !mismatch

  const save = async (e) => {
    e.preventDefault()
    setError('')
    setDone('')
    if (password && password.length < 6) return setError(CREDENTIAL_ERRORS.PASSWORD_TOO_SHORT)
    if (password !== repeat) return setError('Yangi parollar bir xil emas')

    setBusy(true)
    const { data, error } = await supabase.rpc('admin_update_own_credentials', {
      p_current_password: current,
      p_email: emailChanged ? email : null,
      p_password: password || null,
    })
    setBusy(false)
    if (error) return setError(credentialError(error))

    setPassword('')
    setRepeat('')
    setCurrent('')
    setDone([
      data?.email_changed && `Email o'zgardi: endi ${email.trim().toLowerCase()} bilan kirasiz`,
      data?.password_changed && "Parol o'zgardi, boshqa qurilmalardan chiqarib yuborildingiz",
    ].filter(Boolean).join('. ') || 'Saqlandi')
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <div>
        <h2 className="section-title"><LuUserCog size={16} className="text-emerald-700" /> Mening hisobim</h2>
        <p className="text-sm text-slate-500 mt-1">Admin panelga kirish uchun email va parolingiz</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <LuCircleAlert size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {done && (
        <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <LuCheck size={16} className="text-green-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800">{done}</p>
        </div>
      )}

      <div>
        <label className="label">Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" autoComplete="username" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PasswordInput label="Yangi parol" value={password} onChange={setPassword} show={show} setShow={setShow}
          placeholder="O'zgartirmaslik uchun bo'sh qoldiring" />
        <div>
          <PasswordInput label="Yangi parolni qaytaring" value={repeat} onChange={setRepeat} show={show} setShow={setShow} placeholder="Yana bir marta" />
          {mismatch && <p className="text-xs text-red-600 mt-1">Parollar bir xil emas</p>}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100">
        <PasswordInput
          label="Joriy parolingiz (tasdiqlash uchun) *"
          value={current} onChange={setCurrent} show={show} setShow={setShow}
          placeholder="Hozirgi parol" autoComplete="current-password"
        />
      </div>

      <button type="submit" disabled={busy || !canSave} className="btn-primary">
        {busy ? <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" /> : <LuSave size={16} />}
        O'zgarishlarni saqlash
      </button>
    </form>
  )
}

export function PasswordInput({ label, value, onChange, show, setShow, placeholder, autoComplete = 'new-password' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
          className="input-field pr-10" placeholder={placeholder} autoComplete={autoComplete}
        />
        <button
          type="button" onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
          aria-label={show ? 'Parolni yashirish' : "Parolni ko'rsatish"}
        >
          {show ? <LuEyeOff size={16} /> : <LuEye size={16} />}
        </button>
      </div>
    </div>
  )
}
