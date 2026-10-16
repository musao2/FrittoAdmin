import { supabase } from './supabase'

// Davomat selfilari shuncha kun saqlanadi, keyin o'chiriladi (011_photo_retention.sql bilan bir xil)
export const PHOTO_RETENTION_DAYS = 40

const BUCKET = 'attendance-photos'
const KEY = 'fritto_photo_cleanup_day'

/**
 * Muddati o'tgan (40 kundan eski) rasmlarni o'chiradi — har biri o'z muddati bo'yicha.
 * Admin panel ochilganda kuniga bir marta, orqa fonda ishlaydi.
 */
export async function cleanupExpiredPhotos({ force = false } = {}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })
  try {
    if (!force && localStorage.getItem(KEY) === today) return 0
  } catch { /* ahamiyatsiz */ }

  let total = 0
  // Bir martada ko'pi bilan 10 × 200 = 2000 ta rasm (qolgani ertaga)
  for (let round = 0; round < 10; round++) {
    const { data, error } = await supabase.rpc('admin_expired_photos', { p_limit: 200 })
    if (error) {
      // 011 SQL hali ishga tushirilmagan bo'lsa — jim o'tamiz
      if (!(error.code === 'PGRST202' || error.message?.includes('Could not find the function'))) {
        console.warn("Eski rasmlarni o'chirib bo'lmadi:", error.message)
      }
      return total
    }
    const paths = (data || []).map(r => r.photo_path).filter(Boolean)
    if (!paths.length) break

    const removed = []
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100)
      const { data: res, error: rmErr } = await supabase.storage.from(BUCKET).remove(chunk)
      if (rmErr) {
        console.warn("Rasmlarni o'chirishda xato:", rmErr.message)
        return total
      }
      removed.push(...(res || []).map(o => o.name))
    }
    if (!removed.length) break

    await supabase.rpc('admin_mark_photos_deleted', { p_paths: removed })
    total += removed.length
    if (paths.length < 200) break
  }

  try { localStorage.setItem(KEY, today) } catch { /* ahamiyatsiz */ }
  if (total) console.info(`${total} ta eski davomat rasmi o'chirildi (${PHOTO_RETENTION_DAYS} kundan eski)`)
  return total
}
