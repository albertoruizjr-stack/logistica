"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { LALAMOVE_VEHICLE_LABELS } from "@/lib/constants";
import { toWhatsappNumber } from "@/lib/phone";
import {
  Bike, Truck, MapPin, User, Phone, ExternalLink,
  MessageCircle, Copy, Check, DollarSign,
} from "lucide-react";

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

export interface LalamoveRide {
  orderId: string; vehicle: string; status: string;
  driverName: string | null; driverPhone: string | null; driverPlate: string | null;
  price: number | null; shareLink: string | null;
  customerName: string; customerPhone: string | null; address: string;
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
// COMPONENTE PRINCIPAL
// ──────────────────────────────────────────────

export function LalamoveTrackingCards({ rides }: { rides: LalamoveRide[] }) {
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
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}
