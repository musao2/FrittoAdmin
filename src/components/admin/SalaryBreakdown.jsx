import { formatMoney } from '../../lib/supabase'

// Xodimga hali qancha pul berish kerakligini hisoblaydi
export function getRemaining(item) {
  if (!item) return 0
  return item.remaining_payable !== undefined ? item.remaining_payable : (item.net_payable || 0)
}

function Row({ label, hint, value, sign, tone = 'text-slate-900' }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-700">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <p className={`text-sm font-semibold whitespace-nowrap ${tone}`}>
        {sign}{formatMoney(value)}
      </p>
    </div>
  )
}

/**
 * Oddiy chek: qancha ishlab topdi → qancha avans oldi → qancha berildi → qancha qoldi.
 * Har bir qator oddiy so'zlar bilan yozilgan, oxirida katta raqam bilan "Qoldi".
 */
export default function SalaryBreakdown({ item, compact = false }) {
  const earned     = item.total_earned || 0
  const bonus      = item.total_bonuses || 0
  const fine       = item.total_deductions || 0
  const advance    = item.total_advances || 0
  const toPay      = item.net_payable || 0
  const paid       = item.paid_amount || 0
  const remaining  = getRemaining(item)
  const done       = remaining <= 0 && toPay > 0

  return (
    <div>
      <div className="divide-y divide-slate-100">
        <Row
          label="Ishlab topdi"
          hint={compact ? null : `${item.worked_days || 0} kun ishladi`}
          value={earned}
          sign="+"
          tone="text-slate-900"
        />
        {bonus > 0 && <Row label="Bonus" value={bonus} sign="+" tone="text-green-700" />}
        {fine > 0 && <Row label="Jarima" value={fine} sign="−" tone="text-red-600" />}
        <Row
          label="Avans oldi"
          hint={compact ? null : 'Oy davomida oldindan olgan puli'}
          value={advance}
          sign={advance > 0 ? '−' : ''}
          tone={advance > 0 ? 'text-red-600' : 'text-slate-400'}
        />
      </div>

      <div className="flex items-center justify-between gap-3 py-2 border-t-2 border-dashed border-slate-200 mt-1">
        <p className="text-sm font-medium text-slate-900">Oylik (berish kerak)</p>
        <p className="text-sm font-semibold text-slate-900 whitespace-nowrap">{formatMoney(toPay)}</p>
      </div>

      {paid > 0 && (
        <div className="flex items-center justify-between gap-3 py-2">
          <p className="text-sm text-slate-700">Berib bo'lindi</p>
          <p className="text-sm font-semibold text-green-700 whitespace-nowrap">−{formatMoney(paid)}</p>
        </div>
      )}

      <div className={`flex items-center justify-between gap-3 mt-2 px-4 py-3 rounded-lg ${
        done ? 'bg-green-50' : remaining > 0 ? 'bg-emerald-50' : 'bg-slate-50'
      }`}>
        <p className={`text-sm font-medium ${done ? 'text-green-800' : 'text-slate-900'}`}>
          {done ? 'Hammasi berildi' : 'Qoldi'}
        </p>
        <p className={`font-bold whitespace-nowrap ${compact ? 'text-lg' : 'text-2xl'} ${
          done ? 'text-green-700' : remaining > 0 ? 'text-emerald-700' : 'text-slate-500'
        }`}>
          {formatMoney(Math.max(0, remaining))}
        </p>
      </div>
    </div>
  )
}
