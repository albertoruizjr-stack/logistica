"use client";

import { useEffect } from "react";

// Dispara window.print() automaticamente quando a página carrega.
// Usado pela rota /manifest/[routeId]: abre em janela nova → imprime → usuário fecha.
export default function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}
