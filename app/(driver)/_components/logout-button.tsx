"use client";

import { LogOut } from "lucide-react";

export default function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white px-2 py-1.5 rounded hover:bg-white/10"
    >
      <LogOut className="w-3.5 h-3.5" />
      Sair
    </button>
  );
}
