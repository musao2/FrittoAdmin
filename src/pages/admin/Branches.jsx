import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  LuMapPin, LuPlus, LuPencil, LuPrinter, LuRefreshCw, LuX, LuSave, LuCircleAlert,
  LuLocateFixed, LuExternalLink, LuTriangleAlert, LuBuilding2, LuTrash2,
} from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { useBranch } from '../../context/BranchContext'
import { branchQrUrl, newQrCode, parseCoords, osmEmbedUrl, googleMapsUrl } from '../../lib/branchQr'

const EMPTY = { name: '', address: '', latitude: '', longitude: '', radius_m: 50 }
const RADIUS_PRESETS = [25, 50, 100, 200]

export default function AdminBranches() {
  const { reload: reloadSwitcher } = useBranch()
  const [branches, setBranches] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [form, setForm]         = useState(null) // null = yopiq; {id?} = tahrirlash/yangi

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('branches').select('*').order('created_at')
    if (error) {
      setError(error.message?.includes('branches')
        ? "Supabase'da 007_branches_location.sql fayli hali ishga tushirilmagan."
        : error.message)
    } else {
      setError(null)
      setBranches(data || [])
    }
    setLoading(false)
    reloadSwitcher()
  }, [reloadSwitcher])

  useEffect(() => { load() }, [load])

  const regenerate = async (b) => {
    if (!window.confirm(`"${b.name}" uchun yangi QR yaratilsinmi?\n\nEski chop etilgan QR ishlamay qoladi — yangisini chop etib, almashtirishingiz kerak bo'ladi.`)) return
    const { error } = await supabase.from('branches').update({ qr_code: newQrCode(), updated_at: new Date().toISOString() }).eq('id', b.id)
    if (error) return alert(error.message)
    load()
  }

  const toggleActive = async (b) => {
    const { error } = await supabase.from('branches').update({ is_active: !b.is_active, updated_at: new Date().toISOString() }).eq('id', b.id)
    if (error) return alert(error.message)
    load()
  }

  const remove = async (b) => {
    if (!window.confirm(`"${b.name}" filiali o'chirilsinmi?\n\nUning QR kodi ishlamay qoladi. Oldingi davomat yozuvlari saqlanib qoladi.`)) return
    const { error } = await supabase.from('branches').delete().eq('id', b.id)
    if (error) return alert(error.message)
    load()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Filiallar va QR</h1>
          <p className="page-subtitle">
            Har bir filialning joylashuvi va devorga osiladigan QR kodi. Xodim faqat filial ichida turib skanerlay oladi.
          </p>
        </div>
        <button onClick={() => setForm({ ...EMPTY })} className="btn-primary">
          <LuPlus size={16} /> Filial qo'shish
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <div key={i} className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />)}
        </div>
      ) : branches.length === 0 ? (
        <div className="card text-center py-12">
          <LuBuilding2 size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-medium text-slate-900">Hali filial qo'shilmagan</p>
          <p className="text-sm text-slate-500 mt-1">Filial qo'shing — uning QR kodini chop etib, devorga yopishtirasiz.</p>
          <button onClick={() => setForm({ ...EMPTY })} className="btn-primary mx-auto mt-4">
            <LuPlus size={16} /> Filial qo'shish
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {branches.map(b => (
            <div key={b.id} className={`card p-0 overflow-hidden ${b.is_active ? '' : 'opacity-60'}`}>
              <div className="flex gap-4 p-5">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-lg font-heading font-bold text-slate-900 truncate">{b.name}</p>
                    <span className={b.is_active ? 'badge-green' : 'badge-gray'}>{b.is_active ? 'Faol' : "O'chirilgan"}</span>
                  </div>
                  {b.address && <p className="text-sm text-slate-600">{b.address}</p>}
                  <p className="text-sm text-slate-500 flex items-center gap-1.5">
                    <LuMapPin size={14} className="text-emerald-700" />
                    Ruxsat etilgan masofa: <span className="font-medium text-slate-900">{b.radius_m} m</span>
                  </p>
                  <a
                    href={googleMapsUrl(b.latitude, b.longitude)} target="_blank" rel="noreferrer"
                    className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
                  >
                    {b.latitude.toFixed(6)}, {b.longitude.toFixed(6)} <LuExternalLink size={12} />
                  </a>
                </div>
                <div className="flex-shrink-0 bg-white border border-slate-200 rounded-lg p-2">
                  <QRCodeSVG value={branchQrUrl(b.qr_code)} size={112} level="H" marginSize={0} />
                </div>
              </div>

              <iframe
                title={`${b.name} xaritasi`}
                src={osmEmbedUrl(b.latitude, b.longitude, b.radius_m)}
                className="w-full h-44 border-y border-slate-200"
                loading="lazy"
              />

              <div className="p-4 flex flex-wrap gap-2">
                <Link to={`/admin/branches/${b.id}/print`} target="_blank" className="btn-primary flex-1 min-w-36">
                  <LuPrinter size={16} /> QR'ni chop etish
                </Link>
                <button onClick={() => setForm({ ...b })} className="btn-secondary">
                  <LuPencil size={16} /> Tahrirlash
                </button>
                <button onClick={() => regenerate(b)} className="btn-secondary" title="Yangi QR kod (eskisi ishlamay qoladi)">
                  <LuRefreshCw size={16} /> Yangi QR
                </button>
                <button onClick={() => toggleActive(b)} className="btn-secondary">
                  {b.is_active ? "O'chirib qo'yish" : 'Yoqish'}
                </button>
                <button onClick={() => remove(b)} className="btn-danger px-3" title="Filialni o'chirish" aria-label="Filialni o'chirish">
                  <LuTrash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && <BranchForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
    </div>
  )
}

function BranchForm({ initial, onClose, onSaved }) {
  const [f, setF]           = useState({
    ...initial,
    latitude: initial.latitude ?? '',
    longitude: initial.longitude ?? '',
  })
  const [link, setLink]     = useState('')
  const [locating, setLocating] = useState(false)
  const [accuracy, setAccuracy] = useState(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')

  const lat = parseFloat(f.latitude)
  const lng = parseFloat(f.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const radius = Number(f.radius_m) || 0

  const useMyLocation = () => {
    if (!navigator.geolocation) return setError("Bu brauzer joylashuvni aniqlay olmaydi")
    setLocating(true)
    setError('')
    // GPS birinchi o'lchovda adashadi — 15 soniya kuzatib, eng aniq natijani olamiz
    let best = null
    let done = false
    const finish = (err) => {
      if (done) return
      done = true
      navigator.geolocation.clearWatch(watchId)
      clearTimeout(timer)
      setLocating(false)
      if (best) {
        setF(x => ({ ...x, latitude: best.coords.latitude.toFixed(6), longitude: best.coords.longitude.toFixed(6) }))
        setAccuracy(Math.round(best.coords.accuracy))
      } else {
        setError(err?.code === 1
          ? "Joylashuvga ruxsat berilmadi. Brauzer sozlamalarida shu saytga joylashuvni yoqing."
          : "Joylashuvni aniqlab bo'lmadi. Qayta urinib ko'ring yoki xaritadan havola qo'ying.")
      }
    }
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos
        setAccuracy(Math.round(best.coords.accuracy))
        if (pos.coords.accuracy <= 10) finish()
      },
      err => finish(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    )
    const timer = setTimeout(() => finish(), 15000)
  }

  const applyLink = (v) => {
    setLink(v)
    const c = parseCoords(v)
    if (c) setF(x => ({ ...x, latitude: c.lat.toFixed(6), longitude: c.lng.toFixed(6) }))
  }

  const save = async (e) => {
    e.preventDefault()
    setError('')
    if (!f.name.trim()) return setError('Filial nomini yozing')
    if (!hasCoords) return setError("Filial joylashuvini kiriting: «Hozirgi joylashuvimni olish» tugmasini bosing yoki xaritadan havola qo'ying")
    if (radius < 10 || radius > 1000) return setError("Masofa 10 dan 1000 metrgacha bo'lishi kerak")

    setBusy(true)
    const row = {
      name: f.name.trim(),
      address: f.address?.trim() || null,
      latitude: lat,
      longitude: lng,
      radius_m: radius,
      updated_at: new Date().toISOString(),
    }
    const { error } = initial.id
      ? await supabase.from('branches').update(row).eq('id', initial.id)
      : await supabase.from('branches').insert(row)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <form onSubmit={save} className="drawer-panel">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">{initial.id ? 'Filialni tahrirlash' : 'Yangi filial'}</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish">
            <LuX size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-xl mx-auto p-6 space-y-6">
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <LuCircleAlert size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="label">Filial nomi *</label>
                <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="input-field" placeholder="Masalan: Chilonzor filiali" />
              </div>
              <div>
                <label className="label">Manzil</label>
                <input value={f.address || ''} onChange={e => setF({ ...f, address: e.target.value })} className="input-field" placeholder="Ko'cha, uy raqami" />
              </div>
            </div>

            {/* Joylashuv */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Joylashuv *</h3>
                <p className="text-xs text-slate-500 mt-0.5">Eng aniq yo'l — filial ichida turib, <b>telefondan</b> quyidagi tugmani bosing. Kompyuterda joylashuv 50–500 metr xato bo'lishi mumkin.</p>
              </div>

              <button type="button" onClick={useMyLocation} disabled={locating} className="btn-secondary w-full">
                {locating
                  ? <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
                  : <LuLocateFixed size={16} />}
                {locating ? `Aniqlanmoqda...${accuracy != null ? ` ±${accuracy} m` : ''}` : 'Hozirgi joylashuvimni olish'}
              </button>
              {accuracy != null && (
                <p className={`text-xs ${accuracy > 30 ? 'text-amber-700' : 'text-green-700'}`}>
                  Aniqlik: ±{accuracy} m{accuracy > 30 && " — biroz past. Deraza yoniga borib qayta bosing yoki xaritadan aniqlang."}
                </p>
              )}

              <div>
                <label className="label">Yoki xaritadan havola qo'ying</label>
                <input
                  value={link} onChange={e => applyLink(e.target.value)} className="input-field"
                  placeholder="Google Maps havolasi yoki 41.311081, 69.240562"
                />
                {link && !parseCoords(link) && (
                  <p className="text-xs text-amber-700 mt-1">Havoladan koordinata topilmadi. Google Maps'da joyni bosib turing va chiqqan raqamlarni nusxalang.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Kenglik (latitude)</label>
                  <input value={f.latitude} onChange={e => setF({ ...f, latitude: e.target.value })} className="input-field" placeholder="41.311081" inputMode="decimal" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Uzunlik (longitude)</label>
                  <input value={f.longitude} onChange={e => setF({ ...f, longitude: e.target.value })} className="input-field" placeholder="69.240562" inputMode="decimal" />
                </div>
              </div>

              {hasCoords && (
                <iframe
                  title="Filial xaritasi"
                  src={osmEmbedUrl(lat, lng, radius || 50)}
                  className="w-full h-56 rounded-lg border border-slate-200"
                />
              )}
            </section>

            {/* Masofa */}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Ruxsat etilgan masofa</h3>
                <p className="text-xs text-slate-500 mt-0.5">Xodim filialdan shu masofadan uzoqda bo'lsa, skanerlash rad etiladi.</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {RADIUS_PRESETS.map(r => (
                  <button
                    key={r} type="button" onClick={() => setF({ ...f, radius_m: r })}
                    className={`h-10 rounded-lg border text-sm transition-colors cursor-pointer ${
                      radius === r ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-medium' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {r} m
                  </button>
                ))}
              </div>
              <div className="relative max-w-40">
                <input
                  type="number" min="10" max="1000" value={f.radius_m}
                  onChange={e => setF({ ...f, radius_m: e.target.value })}
                  className="input-field pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">m</span>
              </div>
              {radius > 0 && radius < 30 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <LuTriangleAlert size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    Telefon GPS'i bino ichida 5–20 metr, ba'zan undan ham ko'p xato qiladi. {radius} metrdan kichik masofada
                    filial ichida turgan xodimlar ham "uzoqdasiz" deb rad etilishi mumkin. Tavsiya: 50 metr.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-2 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">Bekor qilish</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" /> : <LuSave size={16} />}
            {initial.id ? 'Saqlash' : "Filialni qo'shish"}
          </button>
        </div>
      </form>
    </div>
  )
}
