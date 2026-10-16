import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// Admin panel tepasidagi "Filial" tanlovi — barcha sahifalar shu tanlov bo'yicha filtrlanadi
const BranchContext = createContext(null)
const KEY = 'fritto_admin_branch'

export function BranchProvider({ children }) {
  const [branches, setBranches] = useState([])
  const [selectedId, setSelectedIdState] = useState(() => {
    try { return localStorage.getItem(KEY) || 'all' } catch { return 'all' }
  })

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('branches').select('id, name, is_active').order('created_at')
    if (!error) setBranches(data || [])
  }, [])

  useEffect(() => { reload() }, [reload])

  // Tanlangan filial o'chirib yuborilgan bo'lsa — "Barcha filiallar"ga qaytamiz
  useEffect(() => {
    if (selectedId !== 'all' && branches.length && !branches.some(b => b.id === selectedId)) {
      setSelectedIdState('all')
    }
  }, [branches, selectedId])

  const setSelectedId = useCallback((id) => {
    setSelectedIdState(id)
    try { localStorage.setItem(KEY, id) } catch { /* ahamiyatsiz */ }
  }, [])

  const selected = branches.find(b => b.id === selectedId) || null

  // Xodim tanlangan filialga tegishlimi? (eski xodimlarda faqat matnli nom bo'lishi mumkin)
  const matchEmployee = useCallback((emp) => {
    if (selectedId === 'all') return true
    if (!emp) return false
    if (emp.branch_id) return emp.branch_id === selectedId
    return !!selected && (emp.branch || '').trim().toLowerCase() === selected.name.trim().toLowerCase()
  }, [selectedId, selected])

  const value = useMemo(() => ({
    branches, selectedId, selected, setSelectedId, matchEmployee, reload,
    isFiltered: selectedId !== 'all',
  }), [branches, selectedId, selected, setSelectedId, matchEmployee, reload])

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranch() {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch BranchProvider ichida ishlatilishi kerak')
  return ctx
}
