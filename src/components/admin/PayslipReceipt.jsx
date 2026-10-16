import { LuX, LuBanknote, LuPrinter } from 'react-icons/lu'
import { formatMoney, formatTashkentDate, formatTashkentDateTime } from '../../lib/supabase'
import { getRemaining } from './SalaryBreakdown'
import PaymentMethod from './PaymentMethod'
import { FrittoLogo } from '../Logo'

const MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'
]

// Chekdagi bitta qator: chapda nomi, o'ngda summa
function Line({ label, hint, value, strong, tone = 'text-slate-900' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <span className={`text-sm ${strong ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </div>
      <span className={`text-sm tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : 'font-medium'} ${tone}`}>
        {value}
      </span>
    </div>
  )
}

function Dashed() {
  return <div className="border-t border-dashed border-slate-300 my-4" />
}

function SectionTitle({ children }) {
  return <p className="text-xs font-semibold text-slate-400 mb-1">{children}</p>
}

// Qog'oz chekning tishli qirrasi
function Zigzag({ flip }) {
  return (
    <div
      className={`h-3 w-full ${flip ? 'rotate-180' : ''}`}
      style={{
        background: 'linear-gradient(-45deg, transparent 6px, #fff 0) 0 0 / 12px 12px repeat-x, linear-gradient(45deg, transparent 6px, #fff 0) 0 0 / 12px 12px repeat-x',
      }}
    />
  )
}

/**
 * Ish haqi cheki — o'ng tomondan chiquvchi panel ichida qog'oz chek ko'rinishida.
 * Hisob tartibi: Ishlab topdi + Bonus − Jarima − Avans = Oylik; Oylik − Berildi = Qoldi.
 */
export default function PayslipReceipt({ item, data, loading, month, year, onClose, onPay }) {
  const earned    = item.total_earned || 0
  const bonus     = item.total_bonuses || 0
  const fine      = item.total_deductions || 0
  const advance   = item.total_advances || 0
  const salary    = item.net_payable || 0
  const paid      = item.paid_amount || 0
  const remaining = Math.max(0, getRemaining(item))
  const isPaid    = remaining === 0 && salary > 0
  const hours     = Math.round((item.total_worked_seconds || 0) / 360) / 10

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer-panel bg-slate-100">
        {/* Panel sarlavhasi */}
        <div className="h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between flex-shrink-0 print:hidden">
          <h2 className="text-base font-semibold text-slate-900">Ish haqi cheki</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish">
            <LuX size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto print-scroll-container py-8 px-4">
          <div className="max-w-sm mx-auto drop-shadow-sm">
            <Zigzag flip />
            <div id="printable-receipt" className="bg-white px-7 py-6">
              {/* Boshi */}
              <div className="text-center">
                <FrittoLogo className="h-16 w-auto mx-auto text-[#111111]" />
                <p className="text-xs text-slate-500 mt-3">Ish haqi cheki</p>
                <p className="text-sm font-medium text-slate-900 mt-3">{MONTHS[month - 1]} {year}</p>
              </div>

              <Dashed />

              {/* Kimga */}
              <SectionTitle>XODIM</SectionTitle>
              <p className="text-base font-semibold text-slate-900">{item.employees?.full_name}</p>
              {item.employees?.position && <p className="text-sm text-slate-500">{item.employees.position}</p>}

              <Dashed />

              {/* Ish */}
              <SectionTitle>ISHLADI</SectionTitle>
              <Line label="Kunlar" value={`${item.worked_days || 0} kun`} />
              <Line label="Soatlar" value={`${hours} soat`} />
              {data.hourlyRate && <Line label="Bir soati" value={formatMoney(data.hourlyRate)} />}

              <Dashed />

              {/* Hisob */}
              <SectionTitle>HISOB</SectionTitle>
              <Line label="Ishlab topdi" value={`+${formatMoney(earned)}`} />
              {bonus > 0 && <Line label="Bonus" value={`+${formatMoney(bonus)}`} tone="text-green-700" />}
              {fine > 0 && <Line label="Jarima" value={`−${formatMoney(fine)}`} tone="text-red-600" />}
              <Line
                label="Avans oldi"
                value={advance > 0 ? `−${formatMoney(advance)}` : formatMoney(0)}
                tone={advance > 0 ? 'text-red-600' : 'text-slate-400'}
              />
              <div className="border-t border-slate-200 mt-1.5 pt-1.5">
                <Line label="Oylik" value={formatMoney(salary)} strong />
              </div>
              <Line
                label="Berildi"
                value={paid > 0 ? `−${formatMoney(paid)}` : formatMoney(0)}
                tone={paid > 0 ? 'text-green-700' : 'text-slate-400'}
              />

              {/* Qoldi */}
              <div className={`mt-4 rounded-lg px-4 py-4 text-center ${isPaid ? 'bg-green-50' : 'bg-emerald-50'}`}>
                <p className={`text-xs font-medium ${isPaid ? 'text-green-700' : 'text-emerald-700'}`}>
                  {isPaid ? 'HAMMASI BERILDI' : 'QOLDI — BERISH KERAK'}
                </p>
                <p className={`text-3xl font-bold tabular-nums mt-1 ${isPaid ? 'text-green-700' : 'text-emerald-700'}`}>
                  {formatMoney(remaining)}
                </p>
              </div>

              {/* Avanslar */}
              <Dashed />
              <SectionTitle>AVANSLAR</SectionTitle>
              {loading ? (
                <p className="text-sm text-slate-400 py-1.5">Yuklanmoqda...</p>
              ) : data.advances.length === 0 ? (
                <p className="text-sm text-slate-500 py-1.5">Bu oy avans olmagan</p>
              ) : (
                data.advances.map(a => (
                  <Line
                    key={a.id}
                    label={formatTashkentDate(a.created_at)}
                    hint={a.notes || null}
                    value={`−${formatMoney(a.amount)}`}
                    tone={a.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-red-600'}
                  />
                ))
              )}

              {/* Bonus va jarimalar */}
              {data.adjustments.length > 0 && (
                <>
                  <Dashed />
                  <SectionTitle>BONUS VA JARIMALAR</SectionTitle>
                  {data.adjustments.map(a => (
                    <Line
                      key={a.id}
                      label={a.reason}
                      value={`${a.type === 'bonus' ? '+' : '−'}${formatMoney(a.amount)}`}
                      tone={a.type === 'bonus' ? 'text-green-700' : 'text-red-600'}
                    />
                  ))}
                </>
              )}

              {/* Berilgan pullar */}
              {data.payments.length > 0 && (
                <>
                  <Dashed />
                  <SectionTitle>BERILGAN PULLAR</SectionTitle>
                  {data.payments.map(p => (
                    <div key={p.id} className="flex items-baseline justify-between gap-4 py-1.5">
                      <div className="min-w-0">
                        <span className="text-sm text-slate-600">{formatTashkentDateTime(p.payment_date)}</span>
                        <span className="block text-xs text-slate-400"><PaymentMethod method={p.payment_method} /></span>
                      </div>
                      <span className="text-sm font-medium tabular-nums text-green-700 whitespace-nowrap">{formatMoney(p.amount)}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Imzo */}
              <Dashed />
              <div className="grid grid-cols-2 gap-6 pt-6">
                <div>
                  <div className="border-b border-slate-300 h-6" />
                  <p className="text-xs text-slate-400 mt-1">Xodim imzosi</p>
                </div>
                <div>
                  <div className="border-b border-slate-300 h-6" />
                  <p className="text-xs text-slate-400 mt-1">Kassir imzosi</p>
                </div>
              </div>

              <p className="text-center text-xs text-slate-400 mt-6">
                № {year}{String(month).padStart(2, '0')}-{item.id.slice(0, 6).toUpperCase()}
              </p>
            </div>
            <Zigzag />
          </div>
        </div>

        {/* Tugmalar */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex gap-2 flex-shrink-0 print:hidden">
          {!isPaid && remaining > 0 && (
            <button onClick={onPay} className="btn-primary flex-1">
              <LuBanknote size={16} /> Pul berish
            </button>
          )}
          <button onClick={() => window.print()} className="btn-secondary flex-1">
            <LuPrinter size={16} /> Chop etish
          </button>
        </div>
      </div>
    </div>
  )
}
