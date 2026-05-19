import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listWaves } from "@/services/routing-wave.service";
import { PageHeader, EmptyState } from "@/components/ui";
import { Map, Truck, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import NovaWaveForm from "./_components/nova-wave-form";
import SyncDriversButton from "./_components/sync-drivers-button";
import DeleteWaveButton from "./_components/delete-wave-button";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

const WAVE_STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:       { bg: "bg-gray-100",   text: "text-gray-700",   label: "Rascunho" },
  SENT:        { bg: "bg-blue-100",   text: "text-blue-700",   label: "Otimizando" },
  OPTIMIZED:   { bg: "bg-indigo-100", text: "text-indigo-700", label: "Otimizada" },
  DISTRIBUTED: { bg: "bg-green-100",  text: "text-green-700",  label: "Distribuída" },
  DISPATCHED:  { bg: "bg-purple-100", text: "text-purple-700", label: "Despachada" },
  COMPLETED:   { bg: "bg-emerald-100", text: "text-emerald-700", label: "Concluída" },
  FAILED:      { bg: "bg-red-100",    text: "text-red-700",    label: "Falhou" },
};

export default async function RoteirizacaoPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/dashboard");

  const [eligibleRequests, availableDrivers, recentWaves] = await Promise.all([
    prisma.deliveryRequest.findMany({
      where: {
        status: "PRONTO_ROTEIRIZACAO",
        deliveryAddress: { not: "" },
      },
      select: {
        id:              true,
        orderNumber:     true,
        invoiceNumber:   true,
        customerName:    true,
        deliveryAddress: true,
        deliveryCity:    true,
        totalWeightKg:   true,
        totalLatas:      true,
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.driver.findMany({
      where:   { active: true, available: true },
      select: {
        id:            true,
        name:          true,
        vehicleType:   true,
        spokeDriverId: true,
        email:         true,
      },
      orderBy: { name: "asc" },
    }),
    listWaves({ limit: 10 }),
  ]);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const period = today.getHours() < 12 ? "Manhã" : today.getHours() < 17 ? "Tarde" : "Noite";
  const suggestedName = `${period} ${todayLabel}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Roteirização"
        description={`Crie ondas de entregas otimizadas pelo Spoke · ${eligibleRequests.length} elegíveis · ${availableDrivers.length} motoristas disponíveis`}
        actions={<SyncDriversButton />}
      />

      <div className="grid grid-cols-3 gap-5">
        {/* Form de nova wave (2/3) */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Map className="w-4 h-4 text-orange-500" />
            Nova wave
          </h2>
          <NovaWaveForm
            suggestedName={suggestedName}
            eligibleRequests={eligibleRequests}
            availableDrivers={availableDrivers.map((d) => ({
              id:          d.id,
              name:        d.name,
              vehicleType: d.vehicleType,
              hasSpokeId:  Boolean(d.spokeDriverId),
              hasEmail:    Boolean(d.email),
            }))}
          />
        </div>

        {/* Histórico de waves (1/3) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />
            Waves recentes
          </h2>

          {recentWaves.length === 0 ? (
            <EmptyState
              icon={Map}
              title="Nenhuma wave criada ainda"
              description="A primeira wave aparece aqui depois de criada."
            />
          ) : (
            <ul className="space-y-2 max-h-[600px] overflow-y-auto">
              {recentWaves.map((w) => {
                const cfg = WAVE_STATUS_COLORS[w.status] ?? { bg: "bg-gray-100", text: "text-gray-700", label: w.status };
                const driverCount = w.routes.length;
                const stopCount   = w.routes.reduce((s, r) => s + (r.stopCount ?? 0), 0);
                const canDelete = w.status !== "DISPATCHED" && w.status !== "COMPLETED";
                return (
                  <li key={w.id} className="relative group">
                    <Link
                      href={`/roteirizacao/${w.id}`}
                      className="block rounded-lg border border-gray-200 px-3 py-2.5 pr-8 hover:border-orange-300 hover:bg-orange-50/30 transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{w.name}</p>
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1",
                          cfg.bg, cfg.text,
                        )}>
                          {w.status === "FAILED" && <AlertTriangle className="w-2.5 h-2.5" />}
                          {w.status === "DISTRIBUTED" && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500">
                        <span className="flex items-center gap-1">
                          <Truck className="w-3 h-3" /> {driverCount} mot.
                        </span>
                        <span>{stopCount} paradas</span>
                        <span className="ml-auto">{formatRelativeTime(w.createdAt)}</span>
                      </div>
                      {w.errorMessage && (
                        <p className="text-[10px] text-red-600 mt-1 truncate">{w.errorMessage}</p>
                      )}
                    </Link>
                    {canDelete && (
                      <div className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 transition-opacity">
                        <DeleteWaveButton waveId={w.id} waveName={w.name} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
