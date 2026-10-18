import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { LuPrinter, LuCamera, LuMapPin, LuCircleCheck } from 'react-icons/lu'
import { supabase } from '../../lib/supabase'
import { branchQrUrl } from '../../lib/branchQr'
import { FrittoLogo } from '../../components/Logo'

// Filial QR kodi — A4 varaqqa chop etish uchun plakat
export default function BranchPrint() {
  const { id } = useParams()
  const [branch, setBranch] = useState(null)
  const [error, setError]   = useState(null)

  useEffect(() => {
    supabase.from('branches').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error || !data) setError(error?.message || 'Filial topilmadi')
      else setBranch(data)
    })
  }, [id])

  if (error) return <div className="p-8 text-sm text-red-700">{error}</div>
  if (!branch) return <div className="p-8 text-sm text-slate-500">Yuklanmoqda...</div>

  return (
    <div className="min-h-screen py-8 print:p-0" style={{ backgroundColor: '#FFF4DC' }}>
      <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between gap-3 px-4 print:hidden">
        <p className="text-sm text-slate-600">A4 varaqqa chop eting va filial kirish joyiga yopishtiring.</p>
        <button onClick={() => window.print()} className="btn-primary">
          <LuPrinter size={16} /> Chop etish
        </button>
      </div>

      {/* A4 plakat */}
      {/* Sariq fon chop etishda ham chiqishi uchun: print-color-adjust: exact */}
      <div
        className="print-area mx-auto bg-[#FCA914] w-[210mm] h-[297mm] shadow-lg print:shadow-none flex flex-col items-center justify-between px-[18mm] py-[16mm] text-center"
        style={{ backgroundColor: '#FCA914', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
      >
        <FrittoLogo className="h-[28mm] w-auto text-[#111111]" />

        <div className="w-full">
          <p className="font-heading font-bold text-[13mm] leading-tight text-[#111111]">Davomat</p>
          <p className="text-[6mm] text-[#111111]/75 mt-[2mm]">Kelganda va ketganda skanerlang</p>
        </div>

        <div className="rounded-[6mm] bg-white border-[1.5mm] border-[#111111] p-[6mm]">
          <QRCodeSVG
            value={branchQrUrl(branch.qr_code)}
            size={512}
            level="H"
            marginSize={0}
            fgColor="#111111"
            imageSettings={{ src: '/favicon.svg', height: 96, width: 96, excavate: true }}
            style={{ width: '110mm', height: '110mm' }}
          />
        </div>

        <div className="w-full grid grid-cols-3 gap-[4mm] text-left">
          {[
            { icon: LuCamera, text: 'Telefon kamerasini oching va QR kodga qarating' },
            { icon: LuMapPin, text: "Joylashuvga (GPS) ruxsat bering — filial ichida bo'lishingiz kerak" },
            { icon: LuCircleCheck, text: '«Keldi» yoki «Ketdi» degan yozuv chiqadi' },
          ].map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex gap-[2.5mm] items-start">
              <span className="w-[8mm] h-[8mm] rounded-full bg-[#111111] text-[#FCA914] flex items-center justify-center flex-shrink-0">
                <Icon style={{ width: '4.5mm', height: '4.5mm' }} />
              </span>
              <span className="text-[3.6mm] leading-snug text-[#111111]">{text}</span>
            </div>
          ))}
        </div>

        <div className="w-full border-t border-[#111111]/25 pt-[4mm] flex items-center justify-between text-[3.4mm] text-[#111111]/75">
          <span className="font-heading font-bold text-[#111111] text-[4.5mm]">{branch.name}</span>
          <span>{branch.address || ''}</span>
        </div>
      </div>
    </div>
  )
}
