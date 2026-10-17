import { useEffect, useState, useCallback } from 'react'
import { LuKeyRound, LuCircleCheck, LuTriangleAlert, LuCopy, LuCheck, LuWandSparkles } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { generatePassword } from './EmployeeAccess'
import { credentialError } from './AdminAccountSettings'

/**
 * Sozlamalar: paroli adminga ko'rinmaydigan xodimlar (013 dan oldin qo'yilgan parollar).
 * Bitta tugma bilan hammasiga yangi parol qo'yiladi — shundan keyin hamma parollar ko'rinadi.
 */
export default function PasswordCopyBulk() {
  const [list, setList]       = useState(null)   // null — yuklanmoqda
  const [error, setError]     = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState([])
  const [copied, setCopied]   = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_employees_without_password_copy')
    if (error) { setError(credentialError(error).replace('012_account_credentials', '013_password_vault')); setList([]) }
    else { setError(''); setList(data || []) }
  }, [])

  useEffect(() => { load() }, [load])

  const resetAll = async () => {
    if (!window.confirm(
      `${list.length} ta xodimga yangi parol qo'yiladi.\n\n` +
      "Ular barcha qurilmalardan chiqariladi va YANGI parol bilan kirishi kerak bo'ladi. " +
      'Yangi parollarni keyingi oynada ko\'rasiz va xodimlarga tarqatasiz.\n\nDavom etasizmi?'
    )) return

    setRunning(true)
    setProgress(0)
    const out = []
    for (const emp of list) {
      const password = generatePassword()
      const { error } = await supabase.rpc('admin_set_user_credentials', {
        p_user_id: emp.user_id, p_email: null, p_password: password,
      })
      out.push({ ...emp, password: error ? null : password, error: error ? credentialError(error) : null })
      setProgress(out.length)
    }
    setResults(out)
    setRunning(false)
    load()
  }

  const copyAll = async () => {
    const text = results.filter(r => r.password)
      .map(r => `${r.full_name}\nEmail: ${r.email}\nParol: ${r.password}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ahamiyatsiz */ }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="section-title"><LuKeyRound size={16} className="text-emerald-700" /> Xodimlar parollari</h2>
        <p className="text-sm text-slate-500 mt-1">
          Parollar shifrlangan nusxada saqlanadi va admin xodim sahifasida «Ko'rsatish» bilan ko'radi.
          Bu tizimdan oldin qo'yilgan parollar ko'rinmaydi — ularga bir marta yangi parol qo'yish kerak.
        </p>
      </div>

      {error ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{error}</div>
      ) : list === null ? (
        <div className="h-16 bg-slate-50 rounded-lg animate-pulse" />
      ) : list.length === 0 && !results.length ? (
        <p className="flex items-center gap-2 text-sm text-green-700">
          <LuCircleCheck size={16} /> Barcha xodimlarning paroli adminga ko'rinadi
        </p>
      ) : list.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <LuTriangleAlert size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">{list.length} ta xodimning paroli ko'rinmaydi:</p>
          </div>
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
            {list.map(e => (
              <li key={e.user_id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-slate-900 truncate">{e.full_name}</span>
                <span className="text-slate-500 truncate">{e.email}</span>
              </li>
            ))}
          </ul>
          <button onClick={resetAll} disabled={running} className="btn-primary">
            {running
              ? <><div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" /> {progress}/{list.length}</>
              : <><LuWandSparkles size={16} /> Hammasiga yangi parol qo'yish</>}
          </button>
        </div>
      ) : null}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-900">Yangi parollar — xodimlarga tarqating:</p>
            <button onClick={copyAll} className="btn-secondary h-9 px-3">
              {copied ? <LuCheck size={16} /> : <LuCopy size={16} />} {copied ? 'Nusxalandi' : 'Hammasini nusxalash'}
            </button>
          </div>
          <div className="table-container">
            <table className="w-full">
              <thead>
                <tr><th className="table-head">Xodim</th><th className="table-head">Email</th><th className="table-head">Yangi parol</th></tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.user_id} className="table-row">
                    <td className="table-cell text-slate-900">{r.full_name}</td>
                    <td className="table-cell">{r.email}</td>
                    <td className="table-cell font-mono">
                      {r.password || <span className="text-red-600 font-sans text-xs">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Bu parollar xodim sahifasida «Ko'rsatish» orqali ham doim ko'rinadi.</p>
        </div>
      )}
    </div>
  )
}
