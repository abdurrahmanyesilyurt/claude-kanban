"use client";

import { useState, useEffect, useCallback } from "react";

type NotificationPermission = "granted" | "denied" | "default";

interface NotifyOptions {
  icon?: string;
  tag?: string;
  silent?: boolean;
  onClick?: () => void;
}

interface UseNotificationsReturn {
  permission: NotificationPermission;
  isSupported: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  notify: (title: string, body: string, options?: NotifyOptions) => Notification | null;
}

const STORAGE_KEY = "kanban-notification-permission";

export function useNotifications(): UseNotificationsReturn {
  const isSupported = typeof window !== "undefined" && "Notification" in window;

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (!isSupported) return "denied";
    // Sync with actual browser permission
    const actual = Notification.permission as NotificationPermission;
    // Persist to localStorage so we remember across sessions
    try {
      localStorage.setItem(STORAGE_KEY, actual);
    } catch {
      // localStorage may not be available
    }
    return actual;
  });

  // Sync permission state when the page becomes visible again
  useEffect(() => {
    if (!isSupported) return;

    const sync = () => {
      const current = Notification.permission as NotificationPermission;
      setPermission(current);
      try {
        localStorage.setItem(STORAGE_KEY, current);
      } catch {
        // ignore
      }
    };

    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return "denied";

    // Already decided — no need to ask again
    if (Notification.permission !== "default") {
      const current = Notification.permission as NotificationPermission;
      setPermission(current);
      try {
        localStorage.setItem(STORAGE_KEY, current);
      } catch {
        // ignore
      }
      return current;
    }

    try {
      const result = (await Notification.requestPermission()) as NotificationPermission;
      setPermission(result);
      try {
        localStorage.setItem(STORAGE_KEY, result);
      } catch {
        // ignore
      }
      return result;
    } catch {
      // Some older browsers use a callback-based API; fall back
      return new Promise<NotificationPermission>((resolve) => {
        Notification.requestPermission((result) => {
          const perm = result as NotificationPermission;
          setPermission(perm);
          try {
            localStorage.setItem(STORAGE_KEY, perm);
          } catch {
            // ignore
          }
          resolve(perm);
        });
      });
    }
  }, [isSupported]);

  const notify = useCallback(
    (title: string, body: string, options: NotifyOptions = {}): Notification | null => {
      if (!isSupported || Notification.permission !== "granted") return null;

      const { icon, tag, silent, onClick } = options;

      try {
        const n = new Notification(title, {
          body,
          icon: icon ?? "/favicon.ico",
          tag,
          silent: silent ?? false,
        });

        if (onClick) {
          n.onclick = () => {
            window.focus();
            onClick();
            n.close();
          };
        }

        return n;
      } catch {
        // In some contexts (e.g. service worker not registered) Notification
        // can still throw despite permission being granted — fail gracefully.
        return null;
      }
    },
    [isSupported]
  );

  return { permission, isSupported, requestPermission, notify };
}
