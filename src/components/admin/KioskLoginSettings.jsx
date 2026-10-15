import { useEffect, useState } from 'react'
import { LuQrCode, LuEye, LuEyeOff, LuCircleAlert, LuCheck, LuSave } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'

const ERRORS = {
  PASSWORD_TOO_SHORT: "Parol kamida 6 ta belgidan iborat bo'lishi kerak",
  BAD_EMAIL: "Email noto'g'ri yozilgan",
  ADMIN_ONLY: "Buni faqat admin o'zgartira oladi",
  idx_qr_kiosks_login_email: 'Bu email boshqa QR ekranda ishlatilgan',
}

// QR ekran (kiosk) ga kirish uchun email va parolni o'zgartirish
export default function KioskLoginSettings() {
  const [kiosks, setKiosks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [setupError, setSetupError] = useState(null)

  useEffect(() => {
    supabase
      .from('qr_kiosks')
      .select('id, name, branch, login_email, is_active')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) {
          setSetupError(error.message?.includes('login_email')
            ? "Supabase'da 006_kiosk_login.sql fayli hali ishga tushirilmagan."
            : error.message)
        } else {
          setKiosks(data || [])
        }
        setLoading(false)
      })
  }, [])

  return (
    <div className="card">
      <h2 className="section-title mb-1">
        <LuQrCode size={16} className="text-emerald-600" />
        QR ekranga kirish
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Ish joyidagi QR ekran ochilganda shu email va parol so'raladi.
        Parol o'zgarsa, barcha QR ekranlardan chiqarib yuboriladi va yangi parol bilan qayta kirish kerak bo'ladi.
      </p>

      {loading ? (
        <div className="h-32 bg-slate-50 rounded-lg animate-pulse" />
      ) : setupError ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{setupError}</div>
      ) : kiosks.length === 0 ? (
        <p className="text-sm text-slate-500">Hali QR ekran qo'shilmagan.</p>
      ) : (
        <div className="space-y-4">
          {kiosks.map(k => <KioskForm key={k.id} kiosk={k} />)}
        </div>
      )}
    </div>
  )
}

function KioskForm({ kiosk }) {
  const [email, setEmail]       = useState(kiosk.login_email || '')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat]     = useState('')
  const [show, setShow]         = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [saved, setSaved]       = useState(false)

  const mismatch = password && repeat && password !== repeat
  const changed = email.trim().toLowerCase() !== (kiosk.login_email || '') || password

  const save = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.includes('@')) return setError(ERRORS.BAD_EMAIL)
    if (password && password.length < 6) return setError(ERRORS.PASSWORD_TOO_SHORT)
    if (password !== repeat) return setError('Parollar bir xil emas')

    setBusy(true)
    const { error } = await supabase.rpc('admin_set_kiosk_login', {
      p_kiosk_id: kiosk.id,
      p_email: email,
      p_password: password || null,
    })
    setBusy(false)
    if (error) {
      const code = Object.keys(ERRORS).find(c => error.message?.includes(c))
      return setError(code ? ERRORS[code] : error.message)
    }
    kiosk.login_email = email.trim().toLowerCase()
    setPassword('')
    setRepeat('')
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <form onSubmit={save} className="border border-slate-200 rounded-lg p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-900">{kiosk.name}</p>
        {kiosk.branch && <p className="text-xs text-slate-500">{kiosk.branch} filiali</p>}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <LuCircleAlert size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div>
        <label className="label">Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="fritto@fritto.uz" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Yangi parol</label>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'} value={password}
              onChange={e => setPassword(e.target.value)}
              className="input-field pr-10" placeholder="O'zgartirmaslik uchun bo'sh qoldiring"
              autoComplete="new-password"
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
        <div>
          <label className="label">Parolni qaytaring</label>
          <input
            type={show ? 'text' : 'password'} value={repeat}
            onChange={e => setRepeat(e.target.value)}
            className={`input-field ${mismatch ? 'border-red-500' : ''}`}
            placeholder="Yana bir marta" autoComplete="new-password"
          />
          {mismatch && <p className="text-xs text-red-600 mt-1">Parollar bir xil emas</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !changed || mismatch} className="btn-primary">
          {busy ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <LuSave size={16} />}
          Saqlash
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700">
            <LuCheck size={16} /> Saqlandi
          </span>
        )}
      </div>
    </form>
  )
}
