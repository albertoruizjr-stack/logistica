// Layout do route group (print) — sem sidebar/header.
// Páginas aqui são abertas em nova janela e disparam window.print() automaticamente.
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
