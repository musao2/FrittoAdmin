import { useEffect, useState, useCallback } from 'react'
import { LuKeyRound, LuMail, LuCircleAlert, LuCheck, LuWandSparkles, LuCopy, LuSave, LuLock, LuEye, LuEyeOff } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { PasswordInput, credentialError, CREDENTIAL_ERRORS } from './AdminAccountSettings'

const TZ = 'Asia/Tashkent'
const fmt = (iso) => iso
  ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'hali kirmagan'

// Eslab qolish oson, lekin taxmin qilish qiyin parol: masalan "Fritto-7392-kq"
export function generatePassword() {
  const n = crypto.getRandomValues(new Uint32Array(2))
  const letters = 'abcdefghjkmnpqrstuvwxyz'
  return `Fritto-${1000 + (n[0] % 9000)}-${letters[n[1] % 23]}${letters[(n[1] >>> 8) % 23]}`
}

// "Xodim haqida" paneli ichida: tizimga kirish ma'lumotlari (email, oxirgi kirish) va o'zgartirish
export default function EmployeeAccess({ employee }) {
  const userId = employee?.user_id
  const [info, setInfo]       = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat]   = useState('')
  const [show, setShow]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [done, setDone]       = useState('')
  const [copied, setCopied]   = useState(false)
  // Saqlangan parol nusxasi: undefined — hali so'ralmagan, null — nusxa yo'q (eski parol)
  const [revealed, setRevealed] = useState(undefined)
  const [revealBusy, setRevealBusy] = useState(false)
  const [revealCopied, setRevealCopied] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase.rpc('admin_user_auth_info', { p_user_id: userId })
    if (error) setLoadErr(credentialError(error))
    else { setInfo(data); setEmail(data.email || '') }
  }, [userId])

  useEffect(() => { load() }, [load])

  if (!userId) {
    return (
      <p className="text-sm text-slate-500 border border-slate-200 rounded-lg px-4 py-3">
        Bu xodimning tizimga kirish hisobi yo'q.
      </p>
    )
  }

  const emailChanged = info && email.trim().toLowerCase() !== (info.email || '').toLowerCase()
  const mismatch = password && repeat && password !== repeat

  const save = async () => {
    setError('')
    setDone('')
    if (password && password.length < 6) return setError(CREDENTIAL_ERRORS.PASSWORD_TOO_SHORT)
    if (password !== repeat) return setError('Parollar bir xil emas')
    if (!emailChanged && !password) return setError("Hech narsa o'zgartirilmadi")

    setBusy(true)
    const { data, error } = await supabase.rpc('admin_set_user_credentials', {
      p_user_id: userId,
      p_email: emailChanged ? email : null,
      p_password: password || null,
    })
    setBusy(false)
    if (error) return setError(credentialError(error))

    setDone([
      data?.email_changed && `Email o'zgardi: ${email.trim().toLowerCase()}`,
      data?.password_changed && "Yangi parol saqlandi. Xodim barcha qurilmalardan chiqarildi — yangi parol bilan qayta kiradi",
    ].filter(Boolean).join('. '))
    setPassword('')
    setRepeat('')
    setEditing(false)
    setRevealed(undefined)
    load()
  }

  const reveal = async () => {
    if (revealed !== undefined) { setRevealed(undefined); return } // yashirish
    setRevealBusy(true)
    const { data, error } = await supabase.rpc('admin_reveal_password', { p_user_id: userId })
    setRevealBusy(false)
    if (error) { setError(credentialError(error)); return }
    setRevealed(data ?? null)
  }

  const copyRevealed = async () => {
    try {
      await navigator.clipboard.writeText(revealed)
      setRevealCopied(true)
      setTimeout(() => setRevealCopied(false), 2000)
    } catch { /* ahamiyatsiz */ }
  }

  const fillGenerated = () => {
    const p = generatePassword()
    setPassword(p)
    setRepeat(p)
    setShow(true)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${email.trim()}\nParol: ${password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ahamiyatsiz */ }
  }

  return (
    <div className="space-y-3">
      {loadErr ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{loadErr}</div>
      ) : (
        <dl className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="text-slate-500 flex items-center gap-1.5"><LuMail size={14} /> Email</dt>
            <dd className="text-slate-900 text-right break-all">{info?.email || '...'}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="text-slate-500 flex items-center gap-1.5"><LuLock size={14} /> Parol</dt>
            <dd className="flex items-center gap-2 min-w-0">
              {revealed ? (
                <>
                  <span className="font-mono text-slate-900 break-all">{revealed}</span>
                  <button onClick={copyRevealed} className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer" title="Nusxalash" aria-label="Parolni nusxalash">
                    {revealCopied ? <LuCheck size={14} className="text-green-600" /> : <LuCopy size={14} />}
                  </button>
                </>
              ) : revealed === null ? (
                <span className="text-xs text-amber-700 text-right">Ko'rinmaydi (eski parol) — yangisini qo'ying</span>
              ) : (
                <span className="text-slate-400">••••••••</span>
              )}
              {revealed !== null && (
                <button
                  onClick={reveal} disabled={revealBusy}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {revealBusy
                    ? <div className="w-3 h-3 border-2 border-emerald-700/30 border-t-emerald-700 rounded-full animate-spin" />
                    : revealed ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                  {revealed ? 'Yashirish' : "Ko'rsatish"}
                </button>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="text-slate-500">Oxirgi kirgan</dt>
            <dd className="text-slate-900 text-right">{info ? fmt(info.last_sign_in_at) : '...'}</dd>
          </div>
        </dl>
      )}

      <p className="text-xs text-slate-500">
        Parol shifrlangan holda saqlanadi va faqat admin ko'ra oladi (har ko'rish jurnalga yoziladi). Eski parollar ko'rinmasa — yangisini qo'ying.
      </p>

      {done && (
        <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <LuCheck size={16} className="text-green-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800">{done}</p>
        </div>
      )}

      {!editing ? (
        !loadErr && (
          <button onClick={() => { setEditing(true); setDone('') }} className="btn-secondary w-full">
            <LuKeyRound size={16} /> Email yoki parolni o'zgartirish
          </button>
        )
      ) : (
        <div className="border border-slate-200 rounded-lg p-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <LuCircleAlert size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" />
          </div>

          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <PasswordInput label="Yangi parol" value={password} onChange={setPassword} show={show} setShow={setShow}
                  placeholder="O'zgartirmaslik uchun bo'sh qoldiring" />
              </div>
              <button type="button" onClick={fillGenerated} className="btn-secondary px-3" title="Kuchli parol yaratish">
                <LuWandSparkles size={16} />
              </button>
            </div>
            <PasswordInput label="Parolni qaytaring" value={repeat} onChange={setRepeat} show={show} setShow={setShow} placeholder="Yana bir marta" />
            {mismatch && <p className="text-xs text-red-600 -mt-2">Parollar bir xil emas</p>}
            {password && !mismatch && (
              <button type="button" onClick={copy} className="text-sm text-emerald-700 hover:underline inline-flex items-center gap-1.5 cursor-pointer">
                {copied ? <LuCheck size={14} /> : <LuCopy size={14} />}
                {copied ? 'Nusxalandi' : 'Email va parolni nusxalash (xodimga yuborish uchun)'}
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => { setEditing(false); setError(''); setPassword(''); setRepeat(''); setEmail(info?.email || '') }} disabled={busy} className="btn-secondary">
              Bekor qilish
            </button>
            <button type="button" onClick={save} disabled={busy || mismatch} className="btn-primary flex-1">
              {busy ? <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" /> : <LuSave size={16} />}
              Saqlash
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
