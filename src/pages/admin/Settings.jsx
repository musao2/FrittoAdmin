import { useState } from 'react'
import { LuSettings, LuInfo, LuDatabase, LuCircleCheck, LuCircleX, LuTriangleAlert, LuCheck } from "react-icons/lu"
import KioskLoginSettings from '../../components/admin/KioskLoginSettings'
import AdminAccountSettings from '../../components/admin/AdminAccountSettings'
import PasswordCopyBulk from '../../components/admin/PasswordCopyBulk'
import { Link } from 'react-router-dom'
import { LuMapPin, LuChevronRight } from 'react-icons/lu'

export default function AdminSettings() {
  const [latenessThreshold, setLatenessThreshold] = useState(10)
  const [trialDays, setTrialDays]                 = useState(5)
  const [useWorkDays, setUseWorkDays]             = useState(false)
  const [roundingRule, setRoundingRule]           = useState('round')
  const [saved, setSaved]                         = useState(false)

  const save = () => {
    // Bu sozlamalar keyinchalik database'da saqlanadi
    localStorage.setItem('fritto_settings', JSON.stringify({
      latenessThreshold, trialDays, useWorkDays, roundingRule
    }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <LuSettings size={20} className="text-emerald-700" />
          Sozlamalar
        </h1>
        <p className="page-subtitle">Tizimning umumiy sozlamalari</p>
      </div>

      <AdminAccountSettings />

      <PasswordCopyBulk />

      <Link to="/admin/branches" className="card flex items-center gap-4 hover:border-slate-300">
        <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
          <LuMapPin size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="section-title">Filiallar va QR kodlar</p>
          <p className="text-sm text-slate-500 mt-0.5">
            Filial qo'shish, joylashuvini belgilash, ruxsat etilgan masofa va qog'ozga chiqariladigan QR kod
          </p>
        </div>
        <LuChevronRight size={18} className="text-slate-400 flex-shrink-0" />
      </Link>

      <KioskLoginSettings />

      {/* Env info */}
      <div className="card border-emerald-200 bg-emerald-50/50">
        <h2 className="section-title mb-3">
          <LuDatabase size={16} className="text-emerald-700" />
          Supabase ulanish ma'lumotlari
        </h2>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-dark-500">VITE_SUPABASE_URL</span>
            <span className={`inline-flex items-center gap-1 ${import.meta.env.VITE_SUPABASE_URL ? 'text-green-700' : 'text-red-600'}`}>
              {import.meta.env.VITE_SUPABASE_URL ? <><LuCircleCheck size={14} /> Sozlangan</> : <><LuCircleX size={14} /> Sozlanmagan</>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dark-500">VITE_SUPABASE_ANON_KEY</span>
            <span className={`inline-flex items-center gap-1 ${import.meta.env.VITE_SUPABASE_ANON_KEY ? 'text-green-700' : 'text-red-600'}`}>
              {import.meta.env.VITE_SUPABASE_ANON_KEY ? <><LuCircleCheck size={14} /> Sozlangan</> : <><LuCircleX size={14} /> Sozlanmagan</>}
            </span>
          </div>
        </div>

        {(!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5"><LuTriangleAlert size={14} /> Supabase sozlamalari kiritilmagan</p>
            <p className="text-xs text-dark-500 mt-1">
              Loyiha ildizida <code className="text-dark-300">.env</code> fayl yarating va quyidagilarni qo'shing:
            </p>
            <pre className="mt-2 p-2 bg-dark-900 rounded text-xs text-dark-300 overflow-x-auto">
{`VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
            </pre>
          </div>
        )}
      </div>

      {/* General settings */}
      <div className="card space-y-5">
        <h2 className="section-title">
          <LuSettings size={16} className="text-dark-400" />
          Umumiy sozlamalar
        </h2>

        <div>
          <label className="label">Kechikish chegara vaqti (daqiqa)</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={latenessThreshold}
              onChange={e => setLatenessThreshold(Number(e.target.value))}
              min="0" max="60"
              className="input-field w-24"
            />
            <span className="text-xs text-dark-500">
              Xodim rejalashtirilgan vaqtdan shu ko'p daqiqa o'tib kelsa kechikdi deb hisoblanadi
            </span>
          </div>
        </div>

        <div>
          <label className="label">Test rejimi davomiyligi (kun)</label>
          <input
            type="number"
            value={trialDays}
            onChange={e => setTrialDays(Number(e.target.value))}
            min="1" max="30"
            className="input-field w-24"
          />
        </div>

        <div>
          <label className="label">Test kunlarini hisoblash</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={!useWorkDays}
                onChange={() => setUseWorkDays(false)}
                className="text-emerald-700"
              />
              <span className="text-sm text-dark-300">Kalendar kunlari</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={useWorkDays}
                onChange={() => setUseWorkDays(true)}
                className="text-emerald-700"
              />
              <span className="text-sm text-dark-300">Ish kunlari</span>
            </label>
          </div>
        </div>

        <div>
          <label className="label">Ish haqi yaxlitlash qoidasi</label>
          <select
            value={roundingRule}
            onChange={e => setRoundingRule(e.target.value)}
            className="input-field w-auto"
          >
            <option value="round">Yaxlitlash (matematika)</option>
            <option value="floor">Pastga yaxlitlash</option>
            <option value="ceil">Yuqoriga yaxlitlash</option>
          </select>
        </div>

        <button
          id="save-settings-btn"
          onClick={save}
          className="btn-primary"
        >
          {saved ? <><LuCheck size={16} /> Saqlandi</> : 'Sozlamalarni saqlash'}
        </button>
      </div>

      {/* Info */}
      <div className="card border-dark-700/50">
        <h2 className="section-title mb-3">
          <LuInfo size={16} className="text-dark-500" />
          Tizim haqida
        </h2>
        <div className="space-y-1.5 text-xs text-dark-500">
          <p>Versiya: <span className="text-dark-400">1.0.0</span></p>
          <p>Texnologiyalar: <span className="text-dark-400">React, Vite, Supabase, Tailwind CSS</span></p>
          <p>Vaqt mintaqasi: <span className="text-dark-400">Asia/Tashkent (UTC+5)</span></p>
          <p>© 2024 Fritto HR System</p>
        </div>
      </div>
    </div>
  )
}
