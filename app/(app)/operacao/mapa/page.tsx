import { getSession }           from "@/lib/auth";
import { redirect }             from "next/navigation";
import { getMapViewData }       from "@/services/map-view.service";
import { OperationalMapClient } from "@/components/operacao/mapa/OperationalMapClient";

export const metadata = { title: "Mapa Operacional" };
export const dynamic  = "force-dynamic";

export default async function MapaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) redirect("/dashboard");

  const initial = await getMapViewData(null);

  return <OperationalMapClient initial={initial} />;
}
