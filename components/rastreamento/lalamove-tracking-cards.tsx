"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LALAMOVE_VEHICLE_LABELS } from "@/lib/constants";
import { toWhatsappNumber } from "@/lib/phone";
import {
  Bike, Truck, MapPin, User, Phone, ExternalLink,
  MessageCircle, Copy, Check, DollarSign, XCircle, FileText,
} from "lucide-react";

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

export interface LalamoveRide {
  orderId: string; vehicle: string; status: string;
  driverName: string | null; driverPhone: string | null; driverPlate: string | null;
  price: number | null; shareLink: string | null;
  customerName: string; customerPhone: string | null; address: string;
  invoiceNumber: string | null;
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

// labels amigáveis dos status do Lalamove (status bruto da API)
const STATUS_LABEL: Record<string, string> = {
  PENDING:          "Aguardando",
  ASSIGNING_DRIVER: "Buscando motorista",
  ON_GOING:         "A caminho",
  PICKED_UP:        "Coletado",
  COMPLETED:        "Concluído",
  CANCELLED:        "Cancelado",
  REJECTED:         "Recusado",
  EXPIRED:          "Expirado",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING:          "bg-yellow-100 text-yellow-800 border-yellow-200",
  ASSIGNING_DRIVER: "bg-blue-100 text-blue-800 border-blue-200",
  ON_GOING:         "bg-orange-100 text-orange-800 border-orange-200",
  PICKED_UP:        "bg-indigo-100 text-indigo-800 border-indigo-200",
  COMPLETED:        "bg-green-100 text-green-800 border-green-200",
  CANCELLED:        "bg-gray-100 text-gray-600 border-gray-200",
  REJECTED:         "bg-red-100 text-red-800 border-red-200",
  EXPIRED:          "bg-gray-100 text-gray-600 border-gray-200",
};

function vehicleLabel(vehicle: string): string {
  return (LALAMOVE_VEHICLE_LABELS as Record<string, string>)[vehicle] ?? vehicle;
}

function VehicleIcon({ vehicle }: { vehicle: string }) {
  if (vehicle === "LALAPRO") return <Bike className="w-4 h-4" />;
  return <Truck className="w-4 h-4" />;
}

function formatPrice(price: number): string {
  return `R$ ${price.toFixed(2).replace(".", ",")}`;
}

// ──────────────────────────────────────────────
// POLLING DE STATUS (webhook não configurado)
//
// Enquanto há corridas ativas, dispara POST /api/lalamove/sync a cada 30s para
// puxar status/motorista/placa da API do Lalamove, e então router.refresh()
// re-renderiza com os dados frescos do banco (a página é force-dynamic).
// Sincroniza também no mount para refletir imediatamente ao abrir a tela.
// ──────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

function useLalamovePolling(activeCount: number) {
  const router = useRouter();
  const inFlight = useRef(false);

  useEffect(() => {
    // Sem corridas ativas → nada a sincronizar.
    if (activeCount === 0) return;

    let cancelled = false;

    async function syncOnce() {
      // Evita chamadas sobrepostas (uma requisição lenta não acumula outras).
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/lalamove/sync", { method: "POST" });
        if (!cancelled && res.ok) {
          router.refresh(); // re-renderiza com os dados frescos do banco
        }
      } catch {
        // Erros de rede são ignorados — a próxima rodada tenta de novo.
      } finally {
        inFlight.current = false;
      }
    }

    // Sincroniza ao abrir a tela e depois a cada intervalo.
    void syncOnce();
    const interval = setInterval(() => void syncOnce(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeCount, router]);
}

// ──────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ──────────────────────────────────────────────

export function LalamoveTrackingCards({ rides }: { rides: LalamoveRide[] }) {
  useLalamovePolling(rides.length);

  if (rides.length === 0) {
    return (
      <p className="text-sm text-gray-400">Nenhuma corrida Lalamove ativa no momento.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {rides.map((ride) => (
        <LalamoveCard key={ride.orderId} ride={ride} />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// CARD INDIVIDUAL DA CORRIDA
// ──────────────────────────────────────────────

function LalamoveCard({ ride }: { ride: LalamoveRide }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const waNumber = toWhatsappNumber(ride.customerPhone);
  const canWhatsapp = Boolean(waNumber && ride.shareLink);
  const waUrl = canWhatsapp
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent("Olá! Acompanhe sua entrega: " + ride.shareLink)}`
    : null;

  async function handleCopy() {
    if (!ride.shareLink) return;
    try {
      await navigator.clipboard.writeText(ride.shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // navegador sem permissão de clipboard — silencioso
    }
  }

  async function handleCancel() {
    if (cancelling) return;
    if (!window.confirm("Cancelar esta corrida e devolver a entrega para elegível?")) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch("/api/lalamove/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lalamoveOrderId: ride.orderId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error ?? "Não foi possível cancelar a corrida.");
      }
      if (data.data?.lalamoveCancelled === false) {
        alert("Cancelado no sistema. Confirme no app do Lalamove se a corrida foi realmente cancelada.");
      }
      router.refresh(); // remove o card (a corrida sai da lista de ativas)
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Erro ao cancelar.");
      setCancelling(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-orange-200 transition-shadow hover:shadow-md overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b bg-orange-50 border-orange-100">
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-orange-100 text-orange-600">
          <VehicleIcon vehicle={ride.vehicle} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{vehicleLabel(ride.vehicle)}</p>
          <p className="text-xs text-gray-400 truncate">Lalamove · {ride.orderId.slice(-8)}</p>
        </div>
        <span className={cn(
          "text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
          STATUS_COLOR[ride.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
        )}>
          {STATUS_LABEL[ride.status] ?? ride.status}
        </span>
      </div>

      {/* Motorista */}
      {(ride.driverName || ride.driverPlate || ride.driverPhone) && (
        <div className="px-4 py-3 border-b border-gray-100 space-y-1">
          {ride.driverName && (
            <p className="flex items-center gap-1.5 text-xs text-gray-700 font-medium">
              <User className="w-3.5 h-3.5 text-gray-400" />
              {ride.driverName}
              {ride.driverPlate && (
                <span className="font-mono font-medium text-gray-500 ml-1">{ride.driverPlate}</span>
              )}
            </p>
          )}
          {ride.driverPhone && (
            <p className="flex items-center gap-1.5 text-xs text-gray-400">
              <Phone className="w-3 h-3" />
              {ride.driverPhone}
            </p>
          )}
        </div>
      )}

      {/* Cliente + endereço + preço */}
      <div className="px-4 py-3 border-b border-gray-100 space-y-1">
        <p className="flex items-center gap-1.5 text-xs text-gray-700 font-medium">
          <User className="w-3.5 h-3.5 text-gray-400" />
          <span className="truncate">{ride.customerName}</span>
          {ride.invoiceNumber && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 ml-auto flex-shrink-0">
              <FileText className="w-3 h-3" />
              NF {ride.invoiceNumber}
            </span>
          )}
        </p>
        {ride.address && (
          <p className="flex items-start gap-1.5 text-xs text-gray-400">
            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span className="line-clamp-2">{ride.address}</span>
          </p>
        )}
        {ride.price != null && (
          <p className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
            <DollarSign className="w-3 h-3 text-gray-400" />
            {formatPrice(ride.price)}
          </p>
        )}
      </div>

      {/* Ações */}
      <div className="px-4 py-3 flex items-center gap-2">
        {ride.shareLink ? (
          <a
            href={ride.shareLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Acompanhar
          </a>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-gray-300 cursor-not-allowed">
            <ExternalLink className="w-3.5 h-3.5" />
            Acompanhar
          </span>
        )}

        {canWhatsapp ? (
          <a
            href={waUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-800 hover:underline"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp
          </a>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-gray-300 cursor-not-allowed">
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp
          </span>
        )}

        <button
          type="button"
          onClick={handleCopy}
          disabled={!ride.shareLink}
          className={cn(
            "flex items-center gap-1 text-xs font-medium ml-auto transition-colors",
            ride.shareLink
              ? "text-gray-500 hover:text-gray-800"
              : "text-gray-300 cursor-not-allowed"
          )}
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copiado!" : "Copiar link"}
        </button>
      </div>

      {/* Cancelar corrida */}
      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className={cn(
            "flex items-center gap-1 text-xs font-medium transition-colors",
            cancelling
              ? "text-gray-300 cursor-not-allowed"
              : "text-red-600 hover:text-red-800"
          )}
        >
          <XCircle className="w-3.5 h-3.5" />
          {cancelling ? "Cancelando…" : "Cancelar corrida"}
        </button>
        {cancelError && (
          <p className="mt-1 text-[11px] text-red-600">{cancelError}</p>
        )}
      </div>
    </div>
  );
}
