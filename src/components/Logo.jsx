// FRITTO logotipi: belgi + yozuv
export function LogoMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="flex-shrink-0">
      <rect width="40" height="40" rx="10" fill="#4f46e5" />
      <path d="M13 29V11h14v4.2h-9.2v3.2h7.8v4.2h-7.8V29H13Z" fill="#fff" />
      <circle cx="27.5" cy="26.5" r="2.5" fill="#c7d2fe" />
    </svg>
  )
}

export default function Logo({ size = 32, subtitle }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <LogoMark size={size} />
      <div className="leading-tight min-w-0">
        <p className="text-base font-bold text-slate-900 tracking-[0.08em]">FRITTO</p>
        {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
      </div>
    </div>
  )
}
