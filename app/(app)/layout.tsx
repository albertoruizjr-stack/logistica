import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const [store, urgentCount] = await Promise.all([
    prisma.store.findUnique({
      where: { id: session.storeId },
      select: { name: true, code: true },
    }),
    prisma.deliveryRequest.count({
      where: {
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        deliveryType: "URGENT",
        ...(session.role === "SELLER" ? { storeId: session.storeId } : {}),
      },
    }),
  ]);

  const storeName = store?.name ?? "Loja";
  const storeCode = store?.code ?? "";

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "var(--color-background)" }}>
      <Sidebar
        userRole={session.role}
        userName={session.name}
        storeName={storeName}
        storeCode={storeCode}
        urgentCount={urgentCount}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <Header
          userRole={session.role}
          userName={session.name}
          storeName={storeName}
          storeCode={storeCode}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
