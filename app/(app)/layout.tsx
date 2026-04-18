import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const store = await prisma.store.findUnique({
    where: { id: session.storeId },
    select: { name: true },
  });

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar
        userRole={session.role}
        userName={session.name}
        storeName={store?.name ?? "Loja"}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
