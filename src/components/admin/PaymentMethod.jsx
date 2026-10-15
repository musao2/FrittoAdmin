import { LuBanknote, LuCreditCard, LuLandmark } from 'react-icons/lu'

const METHODS = {
  cash: { label: 'Naqd',     icon: LuBanknote },
  card: { label: 'Karta',    icon: LuCreditCard },
}
const TRANSFER = { label: "O'tkazma", icon: LuLandmark }

// To'lov turini ikonka bilan ko'rsatadi
export default function PaymentMethod({ method }) {
  const { label, icon: Icon } = METHODS[method] || TRANSFER
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={14} className="text-slate-400" />
      {label}
    </span>
  )
}
