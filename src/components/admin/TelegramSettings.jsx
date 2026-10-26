import { useCallback, useEffect, useState } from 'react'
import { LuSend, LuSearch, LuCheck, LuCircleAlert, LuExternalLink } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { PasswordInput } from './AdminAccountSettings'

const ERRORS = {
  BAD_TOKEN: "Token noto'g'ri. @BotFather bergan tokenni to'liq nusxalang (masalan 123456789:AAH...)",
  NO_TOKEN: 'Avval bot tokenini yozing',
  NOT_CONFIGURED: 'Avval token va guruhni tanlab saqlang',
  ADMIN_ONLY: 'Buni faqat admin qila oladi',
}
const tgError = (error) => {
  const msg = error?.message || ''
  if (error?.code === 'PGRST202' || msg.includes('Could not find the function')) {
    return "Supabase'da 023_telegram_bot.sql hali ishga tushirilmagan"
  }
  const key = Object.keys(ERRORS).find(k => msg.includes(k))
  return key ? ERRORS[key] : msg
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// pg_net so'rovi javobini kutish (1–6 soniya)
async function waitResult(fn, id) {
  for (let i = 0; i < 12; i++) {
    await sleep(500)
    const { data, error } = await supabase.rpc(fn, { p_request_id: id })
    if (error) throw error
    if (!data?.pending) return data
  }
  throw new Error("Telegram javob bermadi. Birozdan keyin qayta urinib ko'ring.")
}

// Sozlamalar → Telegram bot: kim keldi / ketdi xabarlari
export default function TelegramSettings() {
  const [status, setStatus]   = useState(null)
  const [token, setToken]     = useState('')
  const [showToken, setShowToken] = useState(false)
  const [chatId, setChatId]   = useState('')
  const [chats, setChats]     = useState(null)
  const [enabled, setEnabled] = useState(true)
  const [notifyIn, setNotifyIn]   = useState(true)
  const [notifyOut, setNotifyOut] = useState(true)
  // 024: kelmaganlar va kunlik hisobot
  const [extra, setExtra] = useState(false)
  const [notifyAbsent, setNotifyAbsent] = useState(true)
  const [absentAfter, setAbsentAfter]   = useState(30)
  const [dailyReport, setDailyReport]   = useState(true)
  const [reportHour, setReportHour]     = useState(22)
  const [busy, setBusy]       = useState('')
  const [error, setError]     = useState('')
  const [done, setDone]       = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_telegram_status')
    if (error) return setError(tgError(error))
    setStatus(data)
    setChatId(data.chat_id || '')
    setEnabled(data.has_token ? data.enabled : true)
    setNotifyIn(data.notify_in)
    setNotifyOut(data.notify_out)
    if ('notify_absent' in data) {
      setExtra(true)
      setNotifyAbsent(data.notify_absent)
      setAbsentAfter(data.absent_after_min)
      setDailyReport(data.daily_report)
      setReportHour(data.report_hour)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (name, fn) => {
    setBusy(name); setError(''); setDone('')
    try { await fn() } catch (e) { setError(tgError(e)) } finally { setBusy('') }
  }

  const findChats = () => run('find', async () => {
    const { data: id, error } = await supabase.rpc('admin_telegram_find_chats_start', { p_token: token || null })
    if (error) throw error
    const res = await waitResult('admin_telegram_find_chats_result', id)
    setChats(res.chats || [])
    if (res.chats?.length === 1) setChatId(res.chats[0].id)
  })

  const save = () => run('save', async () => {
    const { error } = await supabase.rpc('admin_telegram_save', {
      p_token: token || null, p_chat_id: chatId, p_enabled: enabled,
      p_notify_in: notifyIn, p_notify_out: notifyOut,
    })
    if (error) throw error
    if (extra) {
      const { error: e2 } = await supabase.rpc('admin_telegram_save_extra', {
        p_notify_absent: notifyAbsent, p_absent_after_min: Number(absentAfter),
        p_daily_report: dailyReport, p_report_hour: Number(reportHour),
      })
      if (e2) throw e2
    }
    setToken('')
    await load()
    setDone('Saqlandi')
  })

  const test = () => run('test', async () => {
    const { data: id, error } = await supabase.rpc('admin_telegram_test')
    if (error) throw error
    const res = await waitResult('admin_telegram_request_result', id)
    if (!res.ok) throw new Error(`Telegram xatosi: ${res.error || "noma'lum"}. Bot guruhga qo'shilganini tekshiring.`)
    setDone("Sinov xabari yuborildi — Telegram'ni tekshiring")
  })

  const reportNow = () => run('report', async () => {
    const { error } = await supabase.rpc('admin_telegram_report_now')
    if (error) throw error
    setDone("Bugungi hisobot yuborildi — Telegram'ni tekshiring")
  })

  const connected = status?.has_token && status?.chat_id

  return (
    <div className="card space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <LuSend size={18} className="text-emerald-700" /> Telegram bot
          </h2>
          <p className="text-sm text-slate-500 mt-1">Xodim kelganda va ketganda Telegram guruhga xabar keladi. Server kerak emas.</p>
        </div>
        {status && (
          <span className={connected && status.enabled ? 'badge-green' : 'badge-gray'}>
            {connected && status.enabled ? 'Ulangan' : 'Ulanmagan'}
          </span>
        )}
      </div>

      {/* Qadamlar */}
      <ol className="text-sm text-slate-700 space-y-1.5 list-decimal pl-5">
        <li>
          Telegram'da{' '}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-emerald-700 underline inline-flex items-center gap-0.5">
            @BotFather <LuExternalLink size={12} />
          </a>{' '}
          ni oching → <b>/newbot</b> → nom bering → u bergan <b>token</b>ni nusxalang.
        </li>
        <li>Botni xabar keladigan <b>guruhga qo'shing</b> va guruhga istalgan xabar yozing (masalan «salom»).</li>
        <li>Tokenni pastga qo'ying → <b>«Guruhni topish»</b> → guruhni tanlang → <b>Saqlash</b>.</li>
      </ol>

      <div className="space-y-4">
        <div>
          <PasswordInput
            label={status?.has_token ? `Bot token (saqlangan: ${status.token_hint}) — o'zgartirish uchun yangisini yozing` : 'Bot token'}
            value={token}
            onChange={setToken}
            show={showToken}
            setShow={setShowToken}
            placeholder="123456789:AAH..."
            autoComplete="off"
          />
        </div>

        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Guruh (chat)</label>
              {chats && chats.length > 0 ? (
                <select value={chatId} onChange={e => setChatId(e.target.value)} className="input-field">
                  <option value="">Tanlang...</option>
                  {chats.map(c => (
                    <option key={c.id} value={c.id}>{c.title || c.id} {c.type === 'private' ? '(shaxsiy)' : ''}</option>
                  ))}
                </select>
              ) : (
                <input value={chatId} onChange={e => setChatId(e.target.value)} className="input-field" placeholder="Masalan: -1001234567890" />
              )}
            </div>
            <button type="button" onClick={findChats} disabled={!!busy || (!token && !status?.has_token)} className="btn-secondary">
              <LuSearch size={16} /> {busy === 'find' ? 'Qidirilmoqda...' : 'Guruhni topish'}
            </button>
          </div>
          {chats && chats.length === 0 && (
            <p className="text-xs text-amber-700 mt-1.5">
              Hech qanday guruh topilmadi. Botni guruhga qo'shib, guruhga biror xabar yozing va qayta bosing.
            </p>
          )}
        </div>

        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {[
            ['Bot yoqilgan', enabled, setEnabled],
            ['«Keldi» xabari', notifyIn, setNotifyIn],
            ['«Ketdi» xabari', notifyOut, setNotifyOut],
          ].map(([label, val, set]) => (
            <label key={label} className="flex items-center justify-between px-4 py-3 cursor-pointer">
              <span className="text-sm text-slate-900">{label}</span>
              <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="w-4 h-4 accent-[#FCA914]" />
            </label>
          ))}
        </div>

        {extra ? (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
              <span className="text-sm text-slate-900">
                «Kelmadi» xabari
                <span className="block text-xs text-slate-500">Ish boshlanganidan keyin shuncha vaqt o'tsa ham kelmaganlar</span>
              </span>
              <span className="flex items-center gap-2">
                <select value={absentAfter} onChange={e => setAbsentAfter(e.target.value)} disabled={!notifyAbsent} className="input-field h-9 w-auto text-sm">
                  {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} daqiqa</option>)}
                </select>
                <input type="checkbox" checked={notifyAbsent} onChange={e => setNotifyAbsent(e.target.checked)} className="w-4 h-4 accent-[#FCA914]" />
              </span>
            </label>
            <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
              <span className="text-sm text-slate-900">
                Kunlik hisobot
                <span className="block text-xs text-slate-500">Kim keldi, kim kelmadi — har kuni shu soatda</span>
              </span>
              <span className="flex items-center gap-2">
                <select value={reportHour} onChange={e => setReportHour(e.target.value)} disabled={!dailyReport} className="input-field h-9 w-auto text-sm">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <input type="checkbox" checked={dailyReport} onChange={e => setDailyReport(e.target.checked)} className="w-4 h-4 accent-[#FCA914]" />
              </span>
            </label>
          </div>
        ) : status && (
          <p className="text-xs text-amber-700">«Kelmadi» xabari va kunlik hisobot uchun Supabase'da 024_telegram_absent_report.sql ni ishga tushiring.</p>
        )}

        {error && (
          <p className="text-sm text-red-600 flex gap-1.5"><LuCircleAlert size={16} className="flex-shrink-0 mt-0.5" /> {error}</p>
        )}
        {done && <p className="text-sm text-green-700 flex gap-1.5"><LuCheck size={16} className="flex-shrink-0 mt-0.5" /> {done}</p>}

        {extra && connected && (
          <button onClick={reportNow} disabled={!!busy} className="btn-secondary w-full">
            {busy === 'report' ? 'Yuborilmoqda...' : 'Bugungi hisobotni hozir yuborish'}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={save} disabled={!!busy} className="btn-primary">
            {busy === 'save' ? 'Saqlanmoqda...' : 'Saqlash'}
          </button>
          <button onClick={test} disabled={!!busy || !connected} className="btn-secondary">
            <LuSend size={16} /> {busy === 'test' ? 'Yuborilmoqda...' : 'Sinov xabari'}
          </button>
        </div>
      </div>
    </div>
  )
}
