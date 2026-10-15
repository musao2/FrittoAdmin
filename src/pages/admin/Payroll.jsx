import { useState, useEffect, useCallback } from 'react'
import {
  LuDollarSign,
  LuRefreshCw,
  LuCalculator,
  LuCircleCheck,
  LuX,
  LuDownload,
  LuPlus,
  LuMinus,
  LuReceipt,
  LuClock,
  LuWallet,
  LuBuilding2,
  LuCheck,
  LuSparkles,
  LuHistory,
  LuLayoutGrid,
  LuList,
  LuSearch,
  LuBanknote,
  LuLandmark,
  LuCreditCard
} from "react-icons/lu"
import {
  payrollFunctions,
  employeeFunctions,
  adjustmentFunctions,
  formatMoney,
  formatDuration,
  formatTashkentDateTime,
  supabase
} from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import SalaryBreakdown, { getRemaining } from '../../components/admin/SalaryBreakdown'
import PayslipReceipt from '../../components/admin/PayslipReceipt'

const MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'
]

export default function AdminPayroll() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [items, setItems] = useState([])
  const [period, setPeriod] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]     = useState(true)
  const [calculating, setCalculating] = useState(false)
  
  // View mode & search
  const [viewMode, setViewMode]       = useState('cards') // 'cards' | 'table'
  const [searchQuery, setSearchQuery] = useState('')

  // Modals
  const [payModal, setPayModal]         = useState(false)
  const [adjModal, setAdjModal]         = useState(false)
  const [receiptModal, setReceiptModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  
  // Receipt data
  const [receiptData, setReceiptData]   = useState({
    advances: [],
    adjustments: [],
    payments: [],
    hourlyRate: null,
  })
  const [receiptLoading, setReceiptLoading] = useState(false)

  // Financial History Modal State
  const [historyModal, setHistoryModal] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyEmployee, setHistoryEmployee] = useState(null)
  const [historyTab, setHistoryTab]     = useState('all') // 'all' | 'payments' | 'advances' | 'payrolls' | 'adjustments'
  const [historyData, setHistoryData]   = useState({
    items: [],
    payments: [],
    advances: [],
    adjustments: [],
    hourlyRate: null,
  })

  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', notes: '' })
  const [adjForm, setAdjForm] = useState({ type: 'bonus', amount: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (autoRecalculate = true) => {
    setLoading(true)
    try {
      const emps = await employeeFunctions.getAll({ status: 'active' })
      setEmployees(emps)

      const p = await payrollFunctions.getOrCreatePeriod(year, month)
      setPeriod(p)

      // Avtomatik ravishda eng so'nggi davomat yozuvlari bilan xodimlar oyligini sinxronlashtirib hisoblash
      if (autoRecalculate && emps && emps.length > 0) {
        const periodStart = `${year}-${String(month).padStart(2,'0')}-01T00:00:00`
        const lastDay = new Date(year, month, 0).getDate()
        const periodEnd = `${year}-${String(month).padStart(2,'0')}-${lastDay}T23:59:59`
        
        // Bir vaqtda o'nlab so'rov yubormaslik uchun 3 tadan hisoblaymiz
        for (let i = 0; i < emps.length; i += 3) {
          await Promise.all(
            emps.slice(i, i + 3).map(emp => payrollFunctions.calculateForEmployee(emp.id, p.id, periodStart, periodEnd))
          )
        }
      }

      const it = await payrollFunctions.getItems(p.id)
      setItems(it)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { load() }, [load])

  const calculateAll = async () => {
    setCalculating(true)
    try {
      const p = period || await payrollFunctions.getOrCreatePeriod(year, month)
      const periodStart = `${year}-${String(month).padStart(2,'0')}-01T00:00:00`
      const lastDay = new Date(year, month, 0).getDate()
      const periodEnd = `${year}-${String(month).padStart(2,'0')}-${lastDay}T23:59:59`

      for (const emp of employees) {
        await payrollFunctions.calculateForEmployee(emp.id, p.id, periodStart, periodEnd)
      }
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setCalculating(false)
    }
  }

  // item = null bo'lsa, oynada xodimni tanlash kerak bo'ladi
  const openPay = (item) => {
    setSelectedItem(item)
    setPayForm({ amount: item ? (getRemaining(item) || '') : '', method: 'cash', notes: '' })
    setPayModal(true)
  }

  const openAdj = (item) => {
    setSelectedItem(item)
    setAdjForm({ type: 'bonus', amount: '', reason: '' })
    setAdjModal(true)
  }

  const openReceipt = async (item) => {
    setSelectedItem(item)
    setReceiptModal(true)
    setReceiptLoading(true)

    const periodStart = `${year}-${String(month).padStart(2,'0')}-01T00:00:00`
    const lastDay = new Date(year, month, 0).getDate()
    const periodEnd = `${year}-${String(month).padStart(2,'0')}-${lastDay}T23:59:59`

    try {
      const [advRes, adjRes, payRes, rateRes] = await Promise.all([
        supabase
          .from('advances')
          .select('*')
          .eq('employee_id', item.employee_id)
          .gte('created_at', periodStart)
          .lte('created_at', periodEnd)
          .order('created_at', { ascending: false }),
        supabase
          .from('payroll_adjustments')
          .select('*')
          .eq('employee_id', item.employee_id)
          .eq('period_id', period?.id || item.period_id)
          .order('created_at', { ascending: false }),
        supabase
          .from('payments')
          .select('*')
          .or(`payroll_item_id.eq.${item.id},employee_id.eq.${item.employee_id}`)
          .gte('payment_date', periodStart)
          .lte('payment_date', periodEnd)
          .order('payment_date', { ascending: false }),
        supabase
          .from('salary_rates')
          .select('hourly_rate')
          .eq('employee_id', item.employee_id)
          .order('effective_from', { ascending: false })
          .limit(1)
          .maybeSingle()
      ])

      let advancesList = advRes.data || []
      // Agar davr bo'yicha bo'sh bo'lsa va umumiy avans > 0 bo'lsa, xodimning so'nggi avanslarini olamiz
      if (advancesList.length === 0 && item.total_advances > 0) {
        const { data: allAdvs } = await supabase
          .from('advances')
          .select('*')
          .eq('employee_id', item.employee_id)
          .order('created_at', { ascending: false })
          .limit(10)
        advancesList = allAdvs || []
      }

      setReceiptData({
        advances: advancesList,
        adjustments: adjRes.data || [],
        payments: payRes.data || [],
        hourlyRate: rateRes.data?.hourly_rate || null,
      })
    } catch (err) {
      console.error('Error fetching receipt data:', err)
    } finally {
      setReceiptLoading(false)
    }
  }

  const openHistory = async (itemOrEmp) => {
    const empId = itemOrEmp.employee_id || itemOrEmp.id
    const empInfo = itemOrEmp.employees || itemOrEmp
    setHistoryEmployee(empInfo)
    setHistoryModal(true)
    setHistoryLoading(true)
    setHistoryTab('all')

    try {
      const [itRes, payRes, advRes, adjRes, rateRes] = await Promise.all([
        supabase
          .from('payroll_items')
          .select('*, payroll_periods(year, month)')
          .eq('employee_id', empId)
          .order('created_at', { ascending: false }),
        supabase
          .from('payments')
          .select('*')
          .eq('employee_id', empId)
          .order('payment_date', { ascending: false }),
        supabase
          .from('advances')
          .select('*')
          .eq('employee_id', empId)
          .order('created_at', { ascending: false }),
        supabase
          .from('payroll_adjustments')
          .select('*, payroll_periods(year, month)')
          .eq('employee_id', empId)
          .order('created_at', { ascending: false }),
        supabase
          .from('salary_rates')
          .select('hourly_rate')
          .eq('employee_id', empId)
          .order('effective_from', { ascending: false })
          .limit(1)
          .maybeSingle()
      ])

      setHistoryData({
        items: itRes.data || [],
        payments: payRes.data || [],
        advances: advRes.data || [],
        adjustments: adjRes.data || [],
        hourlyRate: rateRes.data?.hourly_rate || null,
      })
    } catch (err) {
      console.error('Moliya tarixini olishda xatolik:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handlePay = async () => {
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) {
      alert("Summa kiriting")
      return
    }
    const remaining = Math.max(0, getRemaining(selectedItem))
    if (parseFloat(payForm.amount) > remaining) {
      alert(`Oylikdan ko'p pul berib bo'lmaydi. Ko'pi bilan ${formatMoney(remaining)} berish mumkin.`)
      return
    }
    setSubmitting(true)
    try {
      await payrollFunctions.markPaid(selectedItem.id, {
        amount: parseFloat(payForm.amount),
        method: payForm.method,
        notes:  payForm.notes,
      }, user.id)
      setPayModal(false)
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleAdj = async () => {
    if (!adjForm.amount || !adjForm.reason) {
      alert("Summa va sabab kiriting")
      return
    }
    setSubmitting(true)
    try {
      await adjustmentFunctions.create({
        employee_id: selectedItem.employee_id,
        period_id:   period.id,
        type:        adjForm.type,
        amount:      parseFloat(adjForm.amount),
        reason:      adjForm.reason,
        status:      'approved',
        created_by:  user.id,
      })
      setAdjModal(false)
      // Qayta hisoblash
      const lastDay = new Date(year, month, 0).getDate()
      await payrollFunctions.calculateForEmployee(
        selectedItem.employee_id,
        period.id,
        `${year}-${String(month).padStart(2,'0')}-01T00:00:00`,
        `${year}-${String(month).padStart(2,'0')}-${lastDay}T23:59:59`
      )
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const exportExcel = () => {
    const rows = items.map(item => ({
      "Xodim":        item.employees?.full_name || '—',
      "Ish kunlari":  item.worked_days,
      "Ishlangan vaqt": formatDuration(item.total_worked_seconds),
      "Jami ish haqi": item.total_earned,
      "Avanslar":     item.total_advances,
      "Bonuslar":     item.total_bonuses,
      "Chegirmalar":  item.total_deductions,
      "To'lanadigan": item.net_payable,
      "Holat":        item.status,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Ish haqi")
    XLSX.writeFile(wb, `ish_haqi_${year}_${month}.xlsx`)
  }

  const totalEarned    = items.reduce((s, i) => s + (i.total_earned || 0), 0)
  const totalAdvances  = items.reduce((s, i) => s + (i.total_advances || 0), 0)
  const totalPaid      = items.reduce((s, i) => s + (i.paid_amount || (i.status === 'paid' ? i.net_payable : 0) || 0), 0)
  const totalRemaining = items.reduce((s, i) => s + (i.status === 'paid' ? 0 : (i.remaining_payable !== undefined ? i.remaining_payable : i.net_payable) || 0), 0)
  const unpaidCount    = items.filter(i => i.status !== 'paid' && ((i.remaining_payable !== undefined ? i.remaining_payable : i.net_payable) > 0)).length

  // Filtered items by search query
  const filteredItems = items.filter(item => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const name = item.employees?.full_name?.toLowerCase() || ''
    const branch = item.employees?.branches?.name?.toLowerCase() || ''
    const role = item.employees?.role?.toLowerCase() || ''
    return name.includes(q) || branch.includes(q) || role.includes(q)
  })

  // History timeline calculations
  const timelineEvents = (() => {
    const events = [];

    // 1. Payments
    const paymentsList = historyData.payments || [];
    paymentsList.forEach(p => {
      events.push({
        id: `pay-${p.id}`,
        type: 'payment',
        date: p.payment_date || p.created_at,
        title: "Kassadan maosh to'landi",
        amount: p.amount,
        badgeText: p.payment_method === 'cash' ? 'Naqd pul' : p.payment_method === 'card' ? 'Plastik karta' : "Bank o'tkazmasi",
        notes: p.notes,
        color: 'emerald',
        icon: LuCircleCheck,
        sign: '+'
      });
    });

    // 2. Advances
    const advancesList = historyData.advances || [];
    advancesList.forEach(a => {
      events.push({
        id: `adv-${a.id}`,
        type: 'advance',
        date: a.created_at,
        title: a.status === 'cancelled' ? "Avans bekor qilingan" : "Oldindan berilgan avans",
        amount: a.amount,
        badgeText: a.payment_type === 'cash' ? 'Naqd' : a.payment_type === 'card' ? 'Karta' : "O'tkazma",
        notes: a.notes,
        color: a.status === 'cancelled' ? 'slate' : 'purple',
        icon: LuWallet,
        sign: '-'
      });
    });

    // 3. Payroll items
    const itemsList = historyData.items || [];
    itemsList.forEach(it => {
      const pMonth = it.payroll_periods?.month ? MONTHS[it.payroll_periods.month - 1] : '';
      const pYear = it.payroll_periods?.year || '';
      events.push({
        id: `pr-${it.id}`,
        type: 'payroll',
        date: it.calculated_at || it.created_at,
        title: `${pMonth} ${pYear} oylik hisob-kitobi`,
        amount: it.net_payable,
        secondaryAmount: it.total_earned,
        badgeText: it.status === 'paid' ? "To'langan" : it.status === 'partial' ? "Qisman to'langan" : "To'lov kutilmoqda",
        notes: `${it.worked_days || 0} kun ishlangan (${formatDuration(it.total_worked_seconds || 0)})`,
        color: 'blue',
        icon: LuCalculator,
        sign: '='
      });
    });

    // 4. Adjustments
    const adjustmentsList = historyData.adjustments || [];
    adjustmentsList.forEach(adj => {
      const isBonus = adj.type === 'bonus';
      events.push({
        id: `adj-${adj.id}`,
        type: 'adjustment',
        date: adj.created_at,
        title: isBonus ? "Bonus mukofoti" : "Jarima / Chegirma",
        amount: adj.amount,
        badgeText: isBonus ? "Rag'batlantirish" : "Ushlab qolish",
        notes: adj.reason,
        color: isBonus ? 'emerald' : 'red',
        icon: isBonus ? LuSparkles : LuMinus,
        sign: isBonus ? '+' : '-'
      });
    });

    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (historyTab === 'payments') return events.filter(e => e.type === 'payment');
    if (historyTab === 'advances') return events.filter(e => e.type === 'advance');
    if (historyTab === 'payrolls') return events.filter(e => e.type === 'payroll');
    if (historyTab === 'adjustments') return events.filter(e => e.type === 'adjustment');
    return events;
  })();

  const histTotalEarned = (historyData.items || []).reduce((s, x) => s + (Number(x.total_earned) || 0), 0);
  const histTotalPaid = (historyData.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const histTotalAdvances = (historyData.advances || []).filter(a => a.status === 'active').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const histTotalBonus = (historyData.adjustments || []).filter(a => a.type === 'bonus').reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const histTotalDeduction = (historyData.adjustments || []).filter(a => a.type === 'deduction').reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const unpaidItems = items.filter(i => getRemaining(i) > 0)
  // Qolgan oylikdan ko'p summa yozilganmi?
  const overpay = Boolean(selectedItem) && Number(payForm.amount) > Math.max(0, getRemaining(selectedItem))

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Sarlavha */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">Ish haqi</h1>
          <p className="page-subtitle">Har bir xodim qancha ishlab topdi, qancha avans oldi va qancha pul qoldi</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input-field w-auto">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input-field w-auto">
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            id="calculate-payroll-btn"
            onClick={calculateAll}
            disabled={calculating}
            className="btn-secondary"
            title="Davomat bo'yicha qaytadan hisoblash"
          >
            <LuRefreshCw size={16} className={calculating ? 'animate-spin' : ''} />
            Qayta hisoblash
          </button>
          <button onClick={exportExcel} className="btn-secondary" title="Excel faylga yuklab olish">
            <LuDownload size={16} /> Excel
          </button>
          <button
            id="open-pay-btn"
            onClick={() => openPay(null)}
            disabled={unpaidItems.length === 0}
            className="btn-primary"
          >
            <LuBanknote size={16} /> Pul berish
          </button>
        </div>
      </div>

      {/* Umumiy natija */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Ishlab topildi" value={totalEarned} hint="Barcha xodimlar bo'yicha" />
        <SummaryCard label="Avans berildi" value={totalAdvances} hint="Oy davomida oldindan" />
        <SummaryCard label="Oylik berildi" value={totalPaid} hint="Kassadan to'langan" tone="text-green-700" />
        <SummaryCard
          label="Hali berilmagan"
          value={totalRemaining}
          hint={totalRemaining === 0 ? "Hammaga to'liq berildi" : `${unpaidCount} ta xodimga berish kerak`}
          tone={totalRemaining === 0 ? 'text-green-700' : 'text-emerald-700'}
        />
      </div>

      {/* Qidiruv va ko'rinish */}
      {items.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <LuSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Xodim ismini yozing..."
              className="input-field pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Tozalash"
              >
                <LuX size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{filteredItems.length} ta xodim</span>
            <div className="flex items-center bg-slate-100 p-1 rounded-lg">
              {[
                { id: 'cards', label: 'Kartalar', icon: LuLayoutGrid },
                { id: 'table', label: 'Jadval', icon: LuList },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  id={`view-mode-${id}`}
                  onClick={() => setViewMode(id)}
                  className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-sm transition-colors cursor-pointer ${
                    viewMode === id ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ro'yxat */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-12">
          <LuDollarSign size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-medium text-slate-900 mb-1">
            {MONTHS[month - 1]} {year} uchun hali hisob yo'q
          </p>
          <p className="text-sm text-slate-500 mb-5">Davomat bo'yicha ish haqini hisoblash uchun tugmani bosing</p>
          <button onClick={calculateAll} disabled={calculating} className="btn-primary mx-auto">
            <LuCalculator size={16} /> Ish haqini hisoblash
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card text-center py-12">
          <LuSearch size={32} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-900">"{searchQuery}" ismli xodim topilmadi</p>
          <button onClick={() => setSearchQuery('')} className="btn-secondary mx-auto mt-4">
            Qidiruvni tozalash
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map(item => {
            const remaining = getRemaining(item)
            return (
              <div key={item.id} className="card flex flex-col">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 font-semibold flex items-center justify-center flex-shrink-0">
                      {item.employees?.full_name?.[0] || 'X'}
                    </div>
                    <div className="min-w-0">
                      <Link
                        to={`/admin/payroll/${item.employee_id}?y=${year}&m=${month}`}
                        className="block text-base font-semibold text-slate-900 truncate hover:text-emerald-700 hover:underline"
                        title="Har kungi to'liq ma'lumotni ko'rish"
                      >
                        {item.employees?.full_name}
                      </Link>
                      <p className="text-xs text-slate-500 truncate">
                        {item.worked_days || 0} kun · {formatDuration(item.total_worked_seconds || 0)}
                      </p>
                    </div>
                  </div>
                  <StatusBadge item={item} />
                </div>

                <div className="flex-1">
                  <SalaryBreakdown item={item} compact />
                </div>

                <div className="mt-4 space-y-2">
                  {remaining > 0 && (
                    <button
                      id={`pay-card-btn-${item.id}`}
                      onClick={() => openPay(item)}
                      className="btn-primary w-full"
                    >
                      <LuBanknote size={16} /> Pul berish
                    </button>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => openReceipt(item)} className="btn-secondary px-2" title="Chekni ko'rish">
                      <LuReceipt size={16} /> Chek
                    </button>
                    <button onClick={() => openHistory(item)} className="btn-secondary px-2" title="Barcha to'lovlar tarixi">
                      <LuHistory size={16} /> Tarix
                    </button>
                    <button onClick={() => openAdj(item)} className="btn-secondary px-2" title="Bonus yoki jarima qo'shish">
                      <LuPlus size={16} /> Bonus
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-head">Xodim</th>
                <th className="table-head text-right">Ishlab topdi</th>
                <th className="table-head text-right">Avans oldi</th>
                <th className="table-head text-right">Berildi</th>
                <th className="table-head text-right">Qoldi</th>
                <th className="table-head">Holat</th>
                <th className="table-head"></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => {
                const remaining = getRemaining(item)
                return (
                  <tr key={item.id} className="table-row">
                    <td className="table-cell">
                      <Link
                        to={`/admin/payroll/${item.employee_id}?y=${year}&m=${month}`}
                        className="font-medium text-slate-900 hover:text-emerald-700 hover:underline"
                      >
                        {item.employees?.full_name}
                      </Link>
                      <p className="text-xs text-slate-500">{item.worked_days || 0} kun · {formatDuration(item.total_worked_seconds || 0)}</p>
                    </td>
                    <td className="table-cell text-right">{formatMoney(item.total_earned)}</td>
                    <td className="table-cell text-right text-red-600">
                      {item.total_advances > 0 ? `−${formatMoney(item.total_advances)}` : '—'}
                    </td>
                    <td className="table-cell text-right text-green-700">
                      {item.paid_amount > 0 ? formatMoney(item.paid_amount) : '—'}
                    </td>
                    <td className="table-cell text-right font-semibold text-slate-900">{formatMoney(Math.max(0, remaining))}</td>
                    <td className="table-cell"><StatusBadge item={item} /></td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-2">
                        {remaining > 0 && (
                          <button id={`pay-btn-${item.id}`} onClick={() => openPay(item)} className="btn-primary h-9 px-3">
                            <LuBanknote size={16} /> Pul berish
                          </button>
                        )}
                        <button onClick={() => openReceipt(item)} className="btn-secondary h-9 px-3" title="Chek">
                          <LuReceipt size={16} />
                        </button>
                        <button onClick={() => openHistory(item)} className="btn-secondary h-9 px-3" title="Tarix">
                          <LuHistory size={16} />
                        </button>
                        <button onClick={() => openAdj(item)} className="btn-secondary h-9 px-3" title="Bonus yoki jarima">
                          <LuPlus size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== CHEK ===== */}
      {receiptModal && selectedItem && (
        <PayslipReceipt
          item={selectedItem}
          data={receiptData}
          loading={receiptLoading}
          month={month}
          year={year}
          onClose={() => setReceiptModal(false)}
          onPay={() => { setReceiptModal(false); openPay(selectedItem) }}
        />
      )}

      {/* ===== PUL BERISH ===== */}
      {payModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPayModal(false)}>
          <div className="drawer-panel">
            <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-900">Pul berish</h2>
              <button onClick={() => setPayModal(false)} className="p-2 -mr-2 text-slate-400 hover:text-slate-900 cursor-pointer" aria-label="Yopish">
                <LuX size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="max-w-md mx-auto p-6 space-y-6">
                {/* 1. Kimga */}
                <div>
                  <label className="label">1. Kimga beriladi?</label>
                  <select
                    value={selectedItem?.id || ''}
                    onChange={e => {
                      const it = items.find(i => i.id === e.target.value)
                      setSelectedItem(it || null)
                      setPayForm(f => ({ ...f, amount: it ? getRemaining(it) : '' }))
                    }}
                    className="input-field"
                  >
                    <option value="">Xodimni tanlang</option>
                    {unpaidItems.map(it => (
                      <option key={it.id} value={it.id}>
                        {it.employees?.full_name} — {formatMoney(getRemaining(it))}
                      </option>
                    ))}
                    {selectedItem && !unpaidItems.some(i => i.id === selectedItem.id) && (
                      <option value={selectedItem.id}>{selectedItem.employees?.full_name}</option>
                    )}
                  </select>
                </div>

                {selectedItem && (
                  <div className="border border-slate-200 rounded-lg p-4">
                    <SalaryBreakdown item={selectedItem} compact />
                  </div>
                )}

                {/* 2. Qancha */}
                <div>
                  <label className="label">2. Qancha beriladi?</label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={payForm.amount}
                      onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                      placeholder="0"
                      min="1"
                      max={selectedItem ? Math.max(0, getRemaining(selectedItem)) : undefined}
                      className={`input-field h-12 text-lg font-semibold pr-14 ${overpay ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">so'm</span>
                  </div>
                  {overpay && (
                    <p className="text-sm text-red-600 mt-1.5">
                      Oylikdan ko'p berib bo'lmaydi. Ko'pi bilan {formatMoney(getRemaining(selectedItem))} berish mumkin.
                    </p>
                  )}
                  {selectedItem && getRemaining(selectedItem) > 0 && Number(payForm.amount) !== getRemaining(selectedItem) && (
                    <button
                      onClick={() => setPayForm({ ...payForm, amount: getRemaining(selectedItem) })}
                      className="text-sm text-emerald-700 hover:underline mt-1.5 cursor-pointer"
                    >
                      Hammasini berish: {formatMoney(getRemaining(selectedItem))}
                    </button>
                  )}
                </div>

                {/* 3. Qanday */}
                <div>
                  <label className="label">3. Qanday beriladi?</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'cash', label: 'Naqd', icon: LuBanknote },
                      { id: 'card', label: 'Karta', icon: LuCreditCard },
                      { id: 'transfer', label: "O'tkazma", icon: LuLandmark },
                    ].map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPayForm({ ...payForm, method: id })}
                        className={`h-16 rounded-lg border flex flex-col items-center justify-center gap-1 text-sm transition-colors cursor-pointer ${
                          payForm.method === id
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700 font-medium'
                            : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon size={18} /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="label">Izoh (shart emas)</label>
                  <input
                    type="text"
                    value={payForm.notes}
                    onChange={e => setPayForm({ ...payForm, notes: e.target.value })}
                    placeholder="Masalan: oktabr oyligi"
                    className="input-field"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex gap-2 flex-shrink-0">
              <button onClick={() => setPayModal(false)} className="btn-secondary">Bekor qilish</button>
              <button
                onClick={handlePay}
                disabled={submitting || !selectedItem || !(Number(payForm.amount) > 0) || overpay}
                className="btn-primary flex-1"
              >
                {submitting
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <LuCheck size={16} />}
                {Number(payForm.amount) > 0 ? `${formatMoney(Number(payForm.amount))} berildi` : 'Pul berildi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment modal */}
      {adjModal && selectedItem && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAdjModal(false)}>
          <div className="modal-content">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-900 text-base">Bonus yoki jarima qo'shish</h2>
              <button onClick={() => setAdjModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <LuX size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <p className="font-bold text-slate-900">{selectedItem.employees?.full_name}</p>
              </div>
              <div>
                <label className="label">Turi</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAdjForm({...adjForm, type: 'bonus'})}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      adjForm.type === 'bonus'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    <LuPlus size={14} className="inline mr-1 text-emerald-600" /> Bonus
                  </button>
                  <button
                    onClick={() => setAdjForm({...adjForm, type: 'deduction'})}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      adjForm.type === 'deduction'
                        ? 'bg-red-50 text-red-700 border-red-300'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    <LuMinus size={14} className="inline mr-1 text-red-600" /> Jarima / Chegirma
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Summa *</label>
                <input
                  type="number"
                  value={adjForm.amount}
                  onChange={e => setAdjForm({...adjForm, amount: e.target.value})}
                  placeholder="Summa..."
                  className="input-field font-semibold"
                />
              </div>
              <div>
                <label className="label">Sabab *</label>
                <textarea
                  value={adjForm.reason}
                  onChange={e => setAdjForm({...adjForm, reason: e.target.value})}
                  placeholder="Sabab kiriting..."
                  className="input-field resize-none"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button onClick={() => setAdjModal(false)} className="btn-secondary">Bekor qilish</button>
              <button onClick={handleAdj} disabled={submitting} className="btn-primary disabled:opacity-50 font-bold">
                {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* XODIM MOLIYA VA TO'LOVLAR TARIXI (FINANCIAL HISTORY MODAL) */}
      {/* ========================================================= */}
      {historyModal && historyEmployee && (
        <div
          className="modal-overlay"
          onClick={e => e.target === e.currentTarget && setHistoryModal(false)}
        >
          <div className="drawer-panel overflow-hidden relative">
            {/* Top Emerald Gradient Accent */}

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-lg flex items-center justify-center flex-shrink-0">
                  {historyEmployee.full_name?.[0] || 'X'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-slate-900 leading-tight">
                      {historyEmployee.full_name}
                    </h2>
                    <span className="text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <LuHistory size={11} className="text-emerald-700" />
                      Moliya tarixi
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-medium flex-wrap">
                    {historyEmployee.branches?.name && (
                      <span className="flex items-center gap-1">
                        <LuBuilding2 size={12} className="text-slate-400" />
                        {historyEmployee.branches.name}
                      </span>
                    )}
                    {historyEmployee.role && <span>• {historyEmployee.role}</span>}
                    {historyData.hourlyRate && (
                      <span className="text-emerald-700 font-bold">
                        • {formatMoney(historyData.hourlyRate)}/soat
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setHistoryModal(false)}
                className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
              >
                <LuX size={20} />
              </button>
            </div>

            {/* All-time Financial KPI Banner */}
            <div className="px-6 py-3.5 bg-slate-50/80 border-b border-slate-200/80 flex-shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-white rounded-xl p-2.5 border border-slate-200">
                  <p className="text-xs font-bold text-slate-400">Jami hisoblangan</p>
                  <p className="text-sm font-semibold text-emerald-700 mt-0.5">+{formatMoney(histTotalEarned)}</p>
                </div>
                <div className="bg-white rounded-xl p-2.5 border border-slate-200">
                  <p className="text-xs font-bold text-slate-400">Jami to'langan</p>
                  <p className="text-sm font-semibold text-blue-700 mt-0.5">{formatMoney(histTotalPaid)}</p>
                </div>
                <div className="bg-white rounded-xl p-2.5 border border-slate-200">
                  <p className="text-xs font-bold text-slate-400">Jami avanslar</p>
                  <p className="text-sm font-semibold text-purple-700 mt-0.5">-{formatMoney(histTotalAdvances)}</p>
                </div>
                <div className="bg-white rounded-xl p-2.5 border border-slate-200">
                  <p className="text-xs font-bold text-slate-400">Bonus / Jarima</p>
                  <p className="text-xs font-bold mt-0.5">
                    <span className="text-emerald-700 font-semibold mr-1">+{formatMoney(histTotalBonus)}</span>
                    <span className="text-red-600 font-semibold">-{formatMoney(histTotalDeduction)}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="px-6 pt-3 pb-2 flex gap-1.5 border-b border-slate-100 overflow-x-auto flex-shrink-0 bg-white">
              {[
                { id: 'all', label: `Barchasi (${timelineEvents.length})` },
                { id: 'payments', label: `To'lovlar (${historyData.payments.length})` },
                { id: 'advances', label: `Avanslar (${historyData.advances.length})` },
                { id: 'payrolls', label: `Oyliklar (${historyData.items.length})` },
                { id: 'adjustments', label: `Bonus / Jarima (${historyData.adjustments.length})` },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setHistoryTab(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    historyTab === tab.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scrollable Timeline */}
            <div className="p-6 overflow-y-auto flex-1 space-y-3 print-scroll-container">
              {historyLoading ? (
                <div className="space-y-3 py-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : timelineEvents.length === 0 ? (
                <div className="text-center py-12">
                  <LuHistory size={36} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-slate-600 font-bold text-sm">Ushbu bo'limda moliya yozuvlari topilmadi</p>
                  <p className="text-slate-400 text-xs mt-1">Tanlangan filtr bo'yicha hech qanday operatsiya amalga oshirilmagan</p>
                </div>
              ) : (
                timelineEvents.map(evt => {
                  const Icon = evt.icon
                  return (
                    <div
                      key={evt.id}
                      className="p-3.5 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          evt.color === 'emerald'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : evt.color === 'purple'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : evt.color === 'blue'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : evt.color === 'red'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-slate-50 text-slate-600 border border-slate-200'
                        }`}>
                          <Icon size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-900 text-xs sm:text-sm">
                              {evt.title}
                            </p>
                            {evt.badgeText && (
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${
                                evt.color === 'emerald' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                evt.color === 'purple' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                evt.color === 'blue' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                evt.color === 'red' ? 'bg-red-50 text-red-700 border-red-200' :
                                'bg-slate-50 text-slate-600 border-slate-200'
                              }`}>
                                {evt.badgeText}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
                            <span className="flex items-center gap-1 font-medium text-slate-500">
                              <LuClock size={11} /> {formatTashkentDateTime(evt.date)}
                            </span>
                            {evt.notes && (
                              <span className="text-slate-500 font-normal">
                                • {evt.notes}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <p className={`font-semibold text-sm sm:text-base ${
                          evt.color === 'emerald'
                            ? 'text-emerald-700'
                            : evt.color === 'purple'
                            ? 'text-purple-700'
                            : evt.color === 'blue'
                            ? 'text-blue-700'
                            : evt.color === 'red'
                            ? 'text-red-600'
                            : 'text-slate-700'
                        }`}>
                          {evt.sign === '+' ? '+' : evt.sign === '-' ? '-' : ''}{formatMoney(evt.amount)}
                        </p>
                        {evt.secondaryAmount !== undefined && (
                          <p className="text-xs text-slate-400 font-semibold">
                            Hisoblangan: {formatMoney(evt.secondaryAmount)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end flex-shrink-0 rounded-b-3xl">
              <button
                onClick={() => setHistoryModal(false)}
                className="btn-secondary px-6 font-semibold cursor-pointer"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, hint, tone = 'text-slate-900' }) {
  return (
    <div className="stat-card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-xl font-semibold truncate ${tone}`}>{formatMoney(value)}</p>
      <p className="text-xs text-slate-400 truncate">{hint}</p>
    </div>
  )
}

function StatusBadge({ item }) {
  const remaining = getRemaining(item)
  if (remaining <= 0 && (item.net_payable || 0) > 0) {
    return <span className="badge-green flex-shrink-0"><LuCircleCheck size={12} /> Berildi</span>
  }
  if ((item.paid_amount || 0) > 0) {
    return <span className="badge-yellow flex-shrink-0">Qisman berildi</span>
  }
  if (remaining > 0) {
    return <span className="badge-gray flex-shrink-0">Berilmagan</span>
  }
  return <span className="badge-gray flex-shrink-0">Hisob yo'q</span>
}
