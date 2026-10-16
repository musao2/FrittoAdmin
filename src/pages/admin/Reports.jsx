import { useState, useCallback } from 'react'
import { LuDownload, LuRefreshCw, LuCalendar } from "react-icons/lu"
import { FiBarChart2 } from "react-icons/fi"
import {
  attendanceFunctions, trialFunctions, advanceFunctions,
  payrollFunctions, employeeFunctions,
  formatMoney, formatDuration, formatTashkentDate, formatTashkentDateTime
} from '../../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import * as XLSX from 'xlsx'
import { useBranch } from '../../context/BranchContext'

const REPORT_TYPES = [
  { value: 'attendance',  label: 'Kunlik davomat' },
  { value: 'payroll',     label: 'Oylik ish haqi' },
  { value: 'advances',    label: 'Avanslar' },
  { value: 'trials',      label: 'Test rejimi' },
  { value: 'branch',      label: 'Filiallar bo\'yicha' },
]

const MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'
]

const PIE_COLORS = ['#FCA914', '#111111', '#FECB4D', '#9A5B00', '#94A3B8']

export default function AdminReports() {
  const { matchEmployee, branches: branchList } = useBranch()
  const now = new Date()
  const [reportType, setReportType] = useState('attendance')
  const [dateFrom, setDateFrom]     = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  )
  const [dateTo, setDateTo] = useState(now.toISOString().split('T')[0])
  const [year, setYear]     = useState(now.getFullYear())
  const [month, setMonth]   = useState(now.getMonth() + 1)
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    setGenerated(false)
    try {
      let result = []

      if (reportType === 'attendance') {
        result = await attendanceFunctions.getAll({
          from: `${dateFrom}T00:00:00`,
          to:   `${dateTo}T23:59:59`,
        })
      } else if (reportType === 'payroll') {
        const period = await payrollFunctions.getOrCreatePeriod(year, month)
        result = await payrollFunctions.getItems(period.id)
      } else if (reportType === 'advances') {
        result = await advanceFunctions.getAll({
          from: `${dateFrom}T00:00:00`,
          to:   `${dateTo}T23:59:59`,
        })
      } else if (reportType === 'trials') {
        result = await trialFunctions.getAll()
      } else if (reportType === 'branch') {
        const emps = (await employeeFunctions.getAll()).filter(matchEmployee)
        const branchNames = Object.fromEntries(branchList.map(b => [b.id, b.name]))
        const branches = {}
        for (const emp of emps) {
          const b = branchNames[emp.branch_id] || emp.branch || 'Noma\'lum'
          if (!branches[b]) branches[b] = { name: b, total: 0, active: 0, trial: 0 }
          branches[b].total++
          if (emp.status === 'active') branches[b].active++
          if (emp.status === 'trial')  branches[b].trial++
        }
        result = Object.values(branches)
      }

      // Admin panel tepasida tanlangan filial bo'yicha
      if (reportType !== 'branch') result = result.filter(r => matchEmployee(r.employees))
      setData(result)
      setGenerated(true)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [reportType, dateFrom, dateTo, year, month, matchEmployee, branchList])

  const exportExcel = () => {
    if (!data.length) return
    let rows = []

    if (reportType === 'attendance') {
      rows = data.map(s => ({
        "Xodim":        s.employees?.full_name || '—',
        "Filial":       s.employees?.branch || '—',
        "Kelgan vaqti":     formatTashkentDateTime(s.check_in_at),
        "Ketgan vaqti":    s.check_out_at ? formatTashkentDateTime(s.check_out_at) : '—',
        "Ishlangan":    formatDuration(s.worked_seconds),
        "Ish haqi":     s.earned_amount || 0,
        "Holat":        s.status,
      }))
    } else if (reportType === 'payroll') {
      rows = data.map(i => ({
        "Xodim":        i.employees?.full_name || '—',
        "Ish kunlari":  i.worked_days,
        "Ishlangan":    formatDuration(i.total_worked_seconds),
        "Ish haqi":     i.total_earned,
        "Avanslar":     i.total_advances,
        "To'lanadigan": i.net_payable,
      }))
    } else if (reportType === 'advances') {
      rows = data.map(a => ({
        "Xodim":  a.employees?.full_name || '—',
        "Summa":  a.amount,
        "Sana":   formatTashkentDateTime(a.created_at),
        "Holat":  a.status,
      }))
    } else if (reportType === 'trials') {
      rows = data.map(t => ({
        "Xodim":   t.employees?.full_name || '—',
        "Boshlanish": formatTashkentDate(t.trial_start_date),
        "Tugash":  formatTashkentDate(t.trial_end_date),
        "Holat":   t.status,
        "Qaror":   t.decision || '—',
      }))
    } else if (reportType === 'branch') {
      rows = data.map(b => ({
        "Filial":       b.name,
        "Jami":         b.total,
        "Faol":         b.active,
        "Test rejimida": b.trial,
      }))
    }

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Hisobot')
    XLSX.writeFile(wb, `hisobot_${reportType}.xlsx`)
  }

  const renderChart = () => {
    if (!generated || !data.length) return null

    if (reportType === 'branch') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="section-title mb-4">Filiallar bo'yicha xodimlar</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="section-title mb-4">Faollik holati</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip />
                <Bar dataKey="active" name="Faol"     fill="#111111" radius={[4,4,0,0]} maxBarSize={28} />
                <Bar dataKey="trial"  name="Test"     fill="#f59e0b" radius={[4,4,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    }

    if (reportType === 'payroll') {
      return (
        <div className="card">
          <h3 className="section-title mb-4">Ish haqi taqsimoti</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.slice(0, 10)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey={d => d.employees?.full_name || '?'} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip formatter={v => formatMoney(v)} />
              <Bar dataKey="total_earned"   name="Ish haqi"    fill="#111111" radius={[4,4,0,0]} maxBarSize={24} />
              <Bar dataKey="total_advances" name="Avanslar"   fill="#8b5cf6" radius={[4,4,0,0]} maxBarSize={24} />
              <Bar dataKey="net_payable"    name="To'lanadigan" fill="#f59e0b" radius={[4,4,0,0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )
    }

    return null
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FiBarChart2 size={20} className="text-emerald-700" />
            Hisobotlar
          </h1>
        </div>
        {generated && data.length > 0 && (
          <button onClick={exportExcel} className="btn-secondary text-xs">
            <LuDownload size={14} /> Excel eksport
          </button>
        )}
      </div>

      {/* Report type & filters */}
      <div className="card space-y-4">
        <div>
          <label className="label">Hisobot turi</label>
          <div className="flex flex-wrap gap-2">
            {REPORT_TYPES.map(rt => (
              <button
                key={rt.value}
                onClick={() => { setReportType(rt.value); setGenerated(false) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  reportType === rt.value
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    : 'bg-dark-900 text-dark-400 border-dark-700'
                }`}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        {(reportType === 'attendance' || reportType === 'advances') && (
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="label">Boshlanish sanasi</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-field w-auto" />
            </div>
            <div>
              <label className="label">Tugash sanasi</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-field w-auto" />
            </div>
          </div>
        )}

        {reportType === 'payroll' && (
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="label">Oy</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input-field w-auto">
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Yil</label>
              <select value={year} onChange={e => setYear(Number(e.target.value))} className="input-field w-auto">
                {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        )}

        <button
          id="generate-report-btn"
          onClick={generate}
          disabled={loading}
          className="btn-primary self-start"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
          ) : <FiBarChart2 size={14} />}
          Hisobot yaratish
        </button>
      </div>

      {/* Charts */}
      {renderChart()}

      {/* Data table */}
      {generated && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Natijalar ({data.length} ta yozuv)</h2>
          </div>

          {data.length === 0 ? (
            <div className="card text-center py-8">
              <FiBarChart2 size={32} className="mx-auto text-dark-600 mb-2" />
              <p className="text-dark-500 text-sm">Ma'lumot topilmadi</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="w-full">
                <thead>
                  <tr>
                    {reportType === 'attendance' && (
                      <>
                        <th className="table-head">Xodim</th>
                        <th className="table-head">Keldi</th>
                        <th className="table-head hidden md:table-cell">Ishlangan</th>
                        <th className="table-head">Ish haqi</th>
                        <th className="table-head hidden md:table-cell">Holat</th>
                      </>
                    )}
                    {reportType === 'payroll' && (
                      <>
                        <th className="table-head">Xodim</th>
                        <th className="table-head">Ish kunlari</th>
                        <th className="table-head">Ish haqi</th>
                        <th className="table-head hidden md:table-cell">Avans</th>
                        <th className="table-head">To'lanadigan</th>
                      </>
                    )}
                    {reportType === 'advances' && (
                      <>
                        <th className="table-head">Xodim</th>
                        <th className="table-head">Summa</th>
                        <th className="table-head">Sana</th>
                        <th className="table-head hidden md:table-cell">Holat</th>
                      </>
                    )}
                    {reportType === 'trials' && (
                      <>
                        <th className="table-head">Xodim</th>
                        <th className="table-head">Boshlanish</th>
                        <th className="table-head">Tugash</th>
                        <th className="table-head">Holat</th>
                      </>
                    )}
                    {reportType === 'branch' && (
                      <>
                        <th className="table-head">Filial</th>
                        <th className="table-head">Jami</th>
                        <th className="table-head">Faol</th>
                        <th className="table-head">Test</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, idx) => (
                    <tr key={idx} className="table-row">
                      {reportType === 'attendance' && (
                        <>
                          <td className="table-cell font-medium text-dark-200">{row.employees?.full_name}</td>
                          <td className="table-cell text-xs text-dark-400">{formatTashkentDateTime(row.check_in_at)}</td>
                          <td className="table-cell hidden md:table-cell text-xs text-dark-400">{formatDuration(row.worked_seconds)}</td>
                          <td className="table-cell text-emerald-700 font-medium">{formatMoney(row.earned_amount)}</td>
                          <td className="table-cell hidden md:table-cell">
                            <span className={row.status === 'open' ? 'badge-yellow' : 'badge-green'}>
                              {row.status === 'open' ? 'Ochiq' : 'Yopilgan'}
                            </span>
                          </td>
                        </>
                      )}
                      {reportType === 'payroll' && (
                        <>
                          <td className="table-cell font-medium text-dark-200">{row.employees?.full_name}</td>
                          <td className="table-cell text-dark-400">{row.worked_days} kun</td>
                          <td className="table-cell text-emerald-700">{formatMoney(row.total_earned)}</td>
                          <td className="table-cell hidden md:table-cell text-purple-400">{formatMoney(row.total_advances)}</td>
                          <td className="table-cell text-amber-400 font-bold">{formatMoney(row.net_payable)}</td>
                        </>
                      )}
                      {reportType === 'advances' && (
                        <>
                          <td className="table-cell font-medium text-dark-200">{row.employees?.full_name}</td>
                          <td className="table-cell text-purple-400 font-medium">{formatMoney(row.amount)}</td>
                          <td className="table-cell text-xs text-dark-400">{formatTashkentDateTime(row.created_at)}</td>
                          <td className="table-cell hidden md:table-cell">
                            <span className={row.status === 'active' ? 'badge-green' : 'badge-gray'}>
                              {row.status === 'active' ? 'Faol' : 'Bekor'}
                            </span>
                          </td>
                        </>
                      )}
                      {reportType === 'trials' && (
                        <>
                          <td className="table-cell font-medium text-dark-200">{row.employees?.full_name}</td>
                          <td className="table-cell text-xs text-dark-400">{formatTashkentDate(row.trial_start_date)}</td>
                          <td className="table-cell text-xs text-dark-400">{formatTashkentDate(row.trial_end_date)}</td>
                          <td className="table-cell">
                            <span className={
                              row.status === 'confirmed' ? 'badge-green' :
                              row.status === 'rejected'  ? 'badge-red' :
                              row.status === 'in_progress' ? 'badge-yellow' : 'badge-gray'
                            }>
                              {row.status}
                            </span>
                          </td>
                        </>
                      )}
                      {reportType === 'branch' && (
                        <>
                          <td className="table-cell font-medium text-dark-200">{row.name}</td>
                          <td className="table-cell text-dark-300">{row.total}</td>
                          <td className="table-cell text-emerald-700">{row.active}</td>
                          <td className="table-cell text-amber-400">{row.trial}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
