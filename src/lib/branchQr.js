// Filialning qog'ozdagi QR kodi ichidagi havola.
// Xodim telefon kamerasi bilan skanerlasa — xodimlar saytining /scan sahifasi ochiladi.
export const USER_APP_URL = (import.meta.env.VITE_USER_APP_URL && import.meta.env.VITE_USER_APP_URL !== 'auto'
  ? import.meta.env.VITE_USER_APP_URL
  : 'https://fritto-user.vercel.app'
).replace(/\/$/, '')

export const branchQrUrl = (code) => `${USER_APP_URL}/scan?b=${code}`

// Yangi QR kod (eski chop etilgan QR ishlamay qolishi uchun)
export function newQrCode() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// Google Maps / Yandex havolasidan yoki "41.31, 69.27" matnidan koordinata ajratib olish
export function parseCoords(text) {
  if (!text) return null
  const t = decodeURIComponent(String(text))
  const patterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,              // google.com/maps/@41.31,69.27,17z
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // ?q=41.31,69.27
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,              // google ...!3d41.31!4d69.27
    /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/,  // 41.31, 69.27
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2])
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
    }
  }
  // Yandex: ?ll=69.27,41.31 (avval uzunlik)
  const y = t.match(/yandex\.[a-z]+\/maps.*[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,2}\.\d+)/)
  if (y) return { lat: parseFloat(y[2]), lng: parseFloat(y[1]) }
  return null
}

// OpenStreetMap xaritasi (kalit talab qilmaydi)
export function osmEmbedUrl(lat, lng, radiusM = 50) {
  const d = Math.max(0.0015, (radiusM / 111000) * 3)
  const bbox = [lng - d, lat - d * 0.75, lng + d, lat + d * 0.75].join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
}

export const googleMapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`
