"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Loader2, X } from "lucide-react";
import { NOTIFICATION_META, type NotificationType } from "@/lib/notifications-types";
import { formatRelativeTime } from "@/lib/utils";

interface NotificationItem {
  id:        string;
  type:      NotificationType;
  title:     string;
  body:      string | null;
  link:      string | null;
  metadata:  unknown;
  readAt:    string | null;
  createdAt: string;
}

const POLL_MS = 30_000; // 30s

export function NotificationBell() {
  const router = useRouter();
  const [items,    setItems]    = useState<NotificationItem[]>([]);
  const [unread,   setUnread]   = useState(0);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [marking,  setMarking]  = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items ?? []);
        setUnread(json.data.unreadCount ?? 0);
      }
    } catch {
      /* silencioso — não bloqueia UI */
    } finally {
      setLoading(false);
    }
  }

  // poll inicial + recorrente
  useEffect(() => {
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function handleItemClick(n: NotificationItem) {
    // marca lida em background, navega imediato
    if (!n.readAt) {
      void fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      }).then(load);
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function handleMarkAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      await load();
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
        aria-label="Notificações"
      >
        <Bell className="w-[18px] h-[18px]" style={{ color: "#1C1C1C" }} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1"
            style={{ backgroundColor: "#DC2626", boxShadow: "0 0 0 1.5px white" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] w-[380px] max-h-[520px] flex flex-col rounded-xl overflow-hidden z-50"
          style={{
            backgroundColor: "white",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
            border: "1px solid var(--color-border)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
               style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold" style={{ fontFamily: "var(--font-display)" }}>Notificações</span>
              {unread > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: "rgba(220,38,38,0.10)", color: "#B91C1C" }}>
                  {unread} novas
                </span>
              )}
            </div>
            <button
              onClick={handleMarkAllRead}
              disabled={marking || unread === 0}
              className="text-[11px] font-medium transition-opacity hover:opacity-70 disabled:opacity-30 inline-flex items-center gap-1"
              style={{ color: "var(--color-primary)" }}
            >
              {marking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Marcar todas
            </button>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--color-muted-text)" }} />
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <Bell className="w-8 h-8 mb-2" style={{ color: "#D1D5DB" }} />
                <p className="text-[12.5px] font-medium" style={{ color: "var(--color-body-text)" }}>
                  Nada por aqui ainda
                </p>
                <p className="text-[11px] mt-1" style={{ color: "var(--color-muted-text)" }}>
                  Você verá atualizações de transferências e pedidos aqui.
                </p>
              </div>
            )}

            {items.length > 0 && (
              <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {items.map(n => {
                  const meta = NOTIFICATION_META[n.type];
                  const isUnread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => handleItemClick(n)}
                        className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-gray-50"
                        style={{ backgroundColor: isUnread ? "rgba(249,115,22,0.025)" : "transparent" }}
                      >
                        {/* indicador de não-lida */}
                        <span
                          className="w-[7px] h-[7px] rounded-full flex-shrink-0 mt-1.5"
                          style={{ backgroundColor: isUnread ? meta.color : "transparent" }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] leading-tight font-semibold"
                             style={{ color: isUnread ? "var(--color-body-text)" : "var(--color-muted-text)" }}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-[11.5px] mt-0.5 leading-snug"
                               style={{ color: "var(--color-muted-text)" }}>
                              {n.body}
                            </p>
                          )}
                          <p className="text-[10px] mt-1 font-mono"
                             style={{ color: "#9CA3AF" }}>
                            {formatRelativeTime(n.createdAt)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
