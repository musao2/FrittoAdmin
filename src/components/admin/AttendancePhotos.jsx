import { useEffect, useState } from 'react'
import { LuX, LuUserRound } from 'react-icons/lu'
import { supabase, formatTashkentDateTime } from '../../lib/supabase'
import { PHOTO_RETENTION_DAYS } from '../../lib/photoRetention'

const BUCKET = 'attendance-photos'

// Davomat selfilari uchun vaqtinchalik (1 soatlik) xavfsiz havolalar
export function usePhotoUrls(sessions) {
  const [urls, setUrls] = useState({})
  const key = sessions.map(s => `${s.in_photo_path || ''}|${s.out_photo_path || ''}`).join(',')

  useEffect(() => {
    const paths = [...new Set(sessions.flatMap(s => [s.in_photo_path, s.out_photo_path]).filter(Boolean))]
    if (!paths.length) { setUrls({}); return }
    let alive = true
    supabase.storage.from(BUCKET).createSignedUrls(paths, 3600).then(({ data }) => {
      if (!alive || !data) return
      setUrls(Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl])))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return urls
}

// Jadval katagi: kelish va ketish rasmlari (bosilsa katta ochiladi)
export function PhotoCell({ session, urls, onOpen }) {
  const items = [
    { label: 'Keldi', path: session.in_photo_path, at: session.check_in_at },
    { label: 'Ketdi', path: session.out_photo_path, at: session.check_out_at },
  ].filter(i => i.path)

  if (!items.length) {
    return <span className="text-slate-300" title={`Rasm yo'q yoki ${PHOTO_RETENTION_DAYS} kundan keyin o'chirilgan`}>—</span>
  }

  return (
    <div className="flex items-center gap-1.5">
      {items.map(i => (
        <button
          key={i.label}
          onClick={() => urls[i.path] && onOpen({ ...i, url: urls[i.path], name: session.employees?.full_name })}
          title={`${i.label} — rasmni kattalashtirish`}
          className="relative w-9 h-9 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:ring-2 hover:ring-emerald-500 cursor-pointer"
        >
          {urls[i.path]
            ? <img src={urls[i.path]} alt={`${i.label} rasmi`} className="w-full h-full object-cover" loading="lazy" />
            : <LuUserRound size={16} className="m-auto text-slate-300" />}
          <span className="absolute bottom-0 inset-x-0 bg-black/55 text-[9px] leading-3 text-white text-center">{i.label}</span>
        </button>
      ))}
    </div>
  )
}

// Katta ko'rinish
export function PhotoViewer({ photo, onClose }) {
  useEffect(() => {
    if (!photo) return
    const esc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [photo, onClose])

  if (!photo) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl overflow-hidden max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-slate-200">
          <p className="text-sm font-medium text-slate-900 truncate">
            {photo.name} · {photo.label} · {formatTashkentDateTime(photo.at)}
          </p>
          <button onClick={onClose} className="p-1.5 -mr-1.5 text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish">
            <LuX size={18} />
          </button>
        </div>
        <img src={photo.url} alt={`${photo.name} — ${photo.label}`} className="w-full max-h-[75vh] object-contain bg-slate-900" />
      </div>
    </div>
  )
}
