import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LogoutButton from "./_components/logout-button";
import DriverLocationTracker from "./_components/driver-location-tracker";

// Layout do app móvel do motorista — mobile-first, sem sidebar.
// Cabeçalho fixo com nome + logout.
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "DRIVER") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-40 bg-black text-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Mestre da Pintura</p>
            <p className="text-sm font-bold leading-tight">{session.name}</p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-4 pb-16">
        <DriverLocationTracker />
        {children}
      </main>
    </div>
  );
}
