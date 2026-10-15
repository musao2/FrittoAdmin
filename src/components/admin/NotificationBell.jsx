import { useState, useEffect, useCallback } from 'react'
import { notificationFunctions, formatTashkentDateTime } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  LuBell,
  LuCheckCheck,
  LuClock,
  LuTriangleAlert,
  LuUserCheck,
  LuDollarSign,
  LuSmartphone
} from 'react-icons/lu'

const NOTIF_ICONS = {
  trial_ending:    <LuTriangleAlert size={14} className="text-amber-500" />,
  trial_ended:     <LuTriangleAlert size={14} className="text-red-500" />,
  checkin:         <LuClock size={14} className="text-emerald-600" />,
  checkout:        <LuClock size={14} className="text-teal-600" />,
  trial_result:    <LuUserCheck size={14} className="text-blue-500" />,
  advance_added:   <LuDollarSign size={14} className="text-emerald-600" />,
  payroll_ready:   <LuDollarSign size={14} className="text-green-600" />,
  late:            <LuTriangleAlert size={14} className="text-orange-500" />,
  forgot_checkout: <LuClock size={14} className="text-red-500" />,
  device_request:  <LuSmartphone size={14} className="text-emerald-600" />,
}

export default function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen]                   = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount]     = useState(0)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const data = await notificationFunctions.getForAdmin()
      setNotifications(data)
      setUnreadCount(data.filter(n => !n.is_read).length)
    } catch (err) {
      console.error(err)
    }
  }, [user])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  const markAll = async () => {
    await notificationFunctions.markAllRead(user.id)
    setUnreadCount(0)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  return (
    <div className="relative">
      <button
        id="notification-bell"
        onClick={() => setOpen(!open)}
        className="relative p-2 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors border border-transparent hover:border-emerald-200"
      >
        <LuBell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-84 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-emerald-50/40">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <LuBell size={15} className="text-emerald-600" />
                Bildirishnomalar
                {unreadCount > 0 && (
                  <span className="bg-red-50 text-red-600 border border-red-200 text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadCount}
                  </span>
                )}
              </h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
                >
                  <LuCheckCheck size={13} />
                  Barchasini o'qish
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">
                  <LuBell size={24} className="mx-auto mb-2 text-slate-300" />
                  Yangi bildirishnoma yo'q
                </div>
              ) : (
                notifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 transition-colors ${
                      !notif.is_read
                        ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex-shrink-0">
                        {NOTIF_ICONS[notif.type] || <LuBell size={14} className="text-slate-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-snug ${!notif.is_read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                          {notif.title}
                        </p>
                        {notif.message && (
                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{notif.message}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                          {formatTashkentDateTime(notif.created_at)}
                        </p>
                      </div>
                      {!notif.is_read && (
                        <div className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
