import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOperationalQueue } from "@/services/operacao.service";
import { isDeliveryPhotoRequired } from "@/services/system-config.service";
import { OperacaoClient } from "./OperacaoClient";

export const metadata = { title: "Operação — Fila Logística" };

// Sem cache — dados operacionais devem ser sempre frescos
export const dynamic = "force-dynamic";

export default async function OperacaoPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    redirect("/dashboard");
  }

  const queue = await getOperationalQueue(session.role);
  const requirePhoto = await isDeliveryPhotoRequired();

  return (
    <OperacaoClient
      initial={queue}
      currentUserId={session.userId}
      currentUserName={session.name}
      currentUserRole={session.role}
      requirePhoto={requirePhoto}
    />
  );
}
