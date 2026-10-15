# FRITTO — Vercel'ga joylash

Uchta alohida sayt joylanadi:

| Papka | Nima | Misol manzil |
|---|---|---|
| `Documents/FrittoUser` | Xodimlar sayti | `https://fritto-user.vercel.app` |
| `Documents/DavomatCrmFritto` | Admin panel | `https://fritto-admin.vercel.app` |
| `Documents/FrittoQR` | QR ekran (kiosk) | `https://fritto-qr.vercel.app` |

**Tartib muhim:** avval xodimlar sayti — chunki QR ekranga uning manzili kerak.

---

## 0. Supabase tayyorligi

Supabase → SQL Editor'da quyidagilar ishga tushirilgan bo'lishi kerak:
`001` → `002` → `003` → `004` → `005` → `006` (`DavomatCrmFritto/supabase/migrations/`).

## 1. Vercel CLI

```bash
npm i -g vercel
vercel login
```

## 2. Xodimlar sayti

```bash
cd ~/Documents/FrittoUser
vercel                     # birinchi marta: loyiha nomini so'raydi (masalan fritto-user)
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod
```

Chiqqan manzilni yozib oling (masalan `https://fritto-user.vercel.app`).

## 3. Admin panel

```bash
cd ~/Documents/DavomatCrmFritto
vercel
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod
```

## 4. QR ekran

```bash
cd ~/Documents/FrittoQR
vercel
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel env add VITE_USER_APP_URL production   # 2-qadamdagi xodimlar sayti manzili, https:// bilan
vercel --prod
```

`VITE_USER_APP_URL` berilmasa, build ataylab to'xtaydi va xabar chiqaradi —
aks holda QR kodlar noto'g'ri manzilga yo'naltirilardi.

`VITE_SUPABASE_URL` va `VITE_SUPABASE_ANON_KEY` qiymatlari — `DavomatCrmFritto/.env` faylidagi qiymatlar
(yoki Supabase → Project Settings → API).

---

## Joylagandan keyin

- QR ekranni planshetda oching → `fritto@fritto.uz` va parol bilan kiring.
- Xodimlar telefonda xodimlar saytiga kiradi → har bir yangi telefon admin paneldagi
  **Xodimlar → Kirish so'rovlari** da tasdiqlanadi.
- Vercel avtomatik HTTPS beradi — telefonda "xavfsiz emas" ogohlantirishi chiqmaydi, kamera ishlaydi.
- O'zgaruvchilarni keyin o'zgartirsangiz (masalan domen), `vercel --prod` ni qayta ishga tushiring —
  `VITE_` qiymatlari build vaqtida kodga yoziladi.

## Nimalar yuklanmaydi

`.vercelignore` tufayli `.env`, `node_modules`, `dist`, lokal sertifikatlar (`.cert`) Vercel'ga yuborilmaydi.
Kalitlar faqat Vercel → Settings → Environment Variables orqali beriladi.
