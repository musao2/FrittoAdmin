import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LuBuilding2, LuChevronDown, LuCheck, LuPlus } from 'react-icons/lu'
import { useBranch } from '../../context/BranchContext'

// Admin panel tepasidagi filial tanlovi — tanlangan filial bo'yicha barcha sahifalar filtrlanadi
export default function BranchSwitcher() {
  const { branches, selectedId, selected, setSelectedId } = useBranch()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const pick = (id) => { setSelectedId(id); setOpen(false) }
  const label = selected ? selected.name : 'Barcha filiallar'

  return (
    <div className="relative" ref={ref}>
      <button
        id="branch-switcher"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 h-10 pl-3 pr-2.5 rounded-lg border text-sm transition-colors cursor-pointer max-w-[52vw] sm:max-w-64 ${
          selected
            ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-medium'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <LuBuilding2 size={16} className="flex-shrink-0" />
        <span className="truncate">{label}</span>
        <LuChevronDown size={16} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 animate-fade-in"
        >
          <p className="px-3 pt-1 pb-2 text-xs text-slate-400">Qaysi filial ma'lumotlari ko'rsatilsin?</p>
          <Option active={selectedId === 'all'} onClick={() => pick('all')}>Barcha filiallar</Option>
          {branches.length > 0 && <div className="my-1 border-t border-slate-100" />}
          {branches.map(b => (
            <Option key={b.id} active={selectedId === b.id} onClick={() => pick(b.id)} muted={!b.is_active}>
              {b.name}{!b.is_active && " (o'chirilgan)"}
            </Option>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <Link
            to="/admin/branches"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 h-9 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            <LuPlus size={15} /> Filiallarni boshqarish
          </Link>
        </div>
      )}
    </div>
  )
}

function Option({ active, muted, onClick, children }) {
  return (
    <button
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-3 h-9 text-sm text-left cursor-pointer hover:bg-slate-50 ${
        active ? 'text-slate-900 font-medium' : muted ? 'text-slate-400' : 'text-slate-700'
      }`}
    >
      <span className="truncate">{children}</span>
      {active && <LuCheck size={16} className="text-emerald-700 flex-shrink-0" />}
    </button>
  )
}
