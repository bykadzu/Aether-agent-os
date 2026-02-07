/**
 * Aether OS — Notification Center
 *
 * Provides a full notification system:
 *  - React context + useNotifications() hook for any component to fire notifications
 *  - Toast notifications (top-right, stacked, auto-dismiss)
 *  - Notification history panel (dropdown from bell icon)
 *  - localStorage persistence (last 100)
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  Bell,
  X,
  Check,
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCheck,
  Trash2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  /** Optional callback when notification is clicked */
  action?: () => void;
  /** Label for the action (shown in panel) */
  actionLabel?: string;
}

export interface NotifyOptions {
  type: NotificationType;
  title: string;
  body: string;
  /** Auto-dismiss duration in ms (default 5000, 0 = no auto-dismiss) */
  duration?: number;
  action?: () => void;
  actionLabel?: string;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  notify: (opts: NotifyOptions) => string;
  dismiss: (id: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'aether_notifications';
const MAX_STORED = 100;
const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_DURATION = 5000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Notification[];
    // Strip action callbacks (not serializable)
    return parsed.map(n => ({ ...n, action: undefined }));
  } catch {
    return [];
  }
}

function saveNotifications(notifications: Notification[]) {
  try {
    const toStore = notifications.slice(0, MAX_STORED).map(({ action: _action, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // quota exceeded — silently drop
  }
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const typeConfig: Record<NotificationType, { icon: React.ReactNode; accent: string; bg: string; border: string }> = {
  info: {
    icon: <Info size={16} />,
    accent: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  success: {
    icon: <Check size={16} />,
    accent: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
  },
  warning: {
    icon: <AlertTriangle size={16} />,
    accent: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
  },
  error: {
    icon: <AlertCircle size={16} />,
    accent: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
  },
};

// ─── Provider ────────────────────────────────────────────────────────────────

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifications);
  const [toasts, setToasts] = useState<(Notification & { removing?: boolean })[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Persist whenever notifications change
  useEffect(() => {
    saveNotifications(notifications);
  }, [notifications]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    // Start fade-out
    setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
    // Remove after animation
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
    // Clear auto-dismiss timer
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const notify = useCallback((opts: NotifyOptions): string => {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const notification: Notification = {
      id,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      timestamp: Date.now(),
      read: false,
      action: opts.action,
      actionLabel: opts.actionLabel,
    };

    // Add to history
    setNotifications(prev => [notification, ...prev].slice(0, MAX_STORED));

    // Add to visible toasts (cap at MAX_VISIBLE_TOASTS)
    setToasts(prev => {
      const updated = [notification, ...prev];
      // If over limit, remove oldest (they'll auto-dismiss anyway)
      if (updated.length > MAX_VISIBLE_TOASTS) {
        const overflow = updated.slice(MAX_VISIBLE_TOASTS);
        overflow.forEach(t => {
          const timer = toastTimers.current.get(t.id);
          if (timer) {
            clearTimeout(timer);
            toastTimers.current.delete(t.id);
          }
        });
        return updated.slice(0, MAX_VISIBLE_TOASTS);
      }
      return updated;
    });

    // Auto-dismiss
    const duration = opts.duration ?? DEFAULT_DURATION;
    if (duration > 0) {
      const timer = setTimeout(() => {
        dismissToast(id);
        toastTimers.current.delete(id);
      }, duration);
      toastTimers.current.set(id, timer);
    }

    return id;
  }, [dismissToast]);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    dismissToast(id);
  }, [dismissToast]);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    notify,
    dismiss,
    markAsRead,
    markAllAsRead,
    clearAll,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </NotificationContext.Provider>
  );
};

// ─── Toast Container ─────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: (Notification & { removing?: boolean })[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed top-10 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 380 }}>
      {toasts.map((toast) => (
        <Toast key={toast.id} notification={toast} removing={toast.removing} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
};

// ─── Single Toast ────────────────────────────────────────────────────────────

interface ToastProps {
  notification: Notification;
  removing?: boolean;
  onDismiss: () => void;
}

const Toast: React.FC<ToastProps> = ({ notification, removing, onDismiss }) => {
  const config = typeConfig[notification.type];

  return (
    <div
      className={`
        pointer-events-auto
        bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl
        shadow-lg shadow-black/20
        px-4 py-3 flex items-start gap-3 w-[360px]
        transition-all duration-300 ease-out cursor-default
        ${removing ? 'opacity-0 translate-x-8' : 'animate-slide-in-right opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      {/* Type Icon */}
      <div className={`mt-0.5 flex-shrink-0 ${config.accent}`}>
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-white truncate">{notification.title}</h4>
          <span className="text-[10px] text-white/40 flex-shrink-0">{relativeTime(notification.timestamp)}</span>
        </div>
        <p className="text-xs text-white/60 mt-0.5 line-clamp-2 leading-relaxed">{notification.body}</p>
      </div>

      {/* Dismiss */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="flex-shrink-0 mt-0.5 text-white/30 hover:text-white/70 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};

// ─── Notification Bell (Menu Bar) ────────────────────────────────────────────

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    // Use capture so it fires before other click handlers on the document
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  return (
    <div className="relative">
      {/* Bell Icon */}
      <button
        ref={bellRef}
        onClick={(e) => { e.stopPropagation(); setIsOpen(prev => !prev); }}
        className="relative flex items-center justify-center hover:bg-white/10 rounded px-1 py-0.5 transition-colors"
        title="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute top-8 right-0 w-[360px] max-h-[480px] bg-black/80 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl shadow-black/40 animate-scale-in z-[9999] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded hover:bg-white/5"
                  title="Mark all as read"
                >
                  <CheckCheck size={12} />
                  <span>Read all</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 text-[10px] text-white/50 hover:text-red-400/80 transition-colors px-2 py-1 rounded hover:bg-white/5"
                  title="Clear all"
                >
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Notification List */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/30">
                <Bell size={28} className="mb-2 opacity-50" />
                <p className="text-xs">No notifications</p>
              </div>
            ) : (
              notifications.map(n => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={() => {
                    markAsRead(n.id);
                    if (n.action) {
                      n.action();
                      setIsOpen(false);
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Single Notification in Panel ────────────────────────────────────────────

interface NotificationItemProps {
  notification: Notification;
  onClick: () => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onClick }) => {
  const config = typeConfig[notification.type];

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-3 flex items-start gap-3 border-b border-white/5
        transition-colors hover:bg-white/5 cursor-pointer
        ${!notification.read ? 'bg-white/[0.03]' : ''}
      `}
    >
      {/* Icon */}
      <div className={`mt-0.5 flex-shrink-0 ${config.accent}`}>
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${!notification.read ? 'text-white' : 'text-white/70'}`}>
            {notification.title}
          </span>
          {!notification.read && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-white/50 mt-0.5 line-clamp-2 leading-relaxed">{notification.body}</p>
        <span className="text-[10px] text-white/30 mt-1 block">{relativeTime(notification.timestamp)}</span>
      </div>

      {/* Action hint */}
      {notification.actionLabel && (
        <span className="text-[10px] text-indigo-400 flex-shrink-0 mt-0.5">{notification.actionLabel}</span>
      )}
    </button>
  );
};
