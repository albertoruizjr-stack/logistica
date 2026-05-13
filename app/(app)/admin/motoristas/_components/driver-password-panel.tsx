"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Key, X, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  driverId:   string;
  driverName: string;
  hasUser:    boolean;
  hasEmail:   boolean;
}

export default function DriverPasswordPanel({ driverId, driverName, hasUser, hasEmail }: Props) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [pwd,     setPwd]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (pwd.length < 4) {
      setError("Senha precisa de pelo menos 4 caracteres");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/motoristas/${driverId}/senha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao definir senha");
        return;
      }
      setSuccess(true);
      setPwd("");
      router.refresh();
      setTimeout(() => { setOpen(false); setSuccess(false); }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  if (!hasEmail) {
    return <span className="text-[11px] text-gray-400 italic">sem email</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-orange-600 hover:underline flex items-center gap-1 ml-auto"
      >
        <Key className="w-3 h-3" />
        {hasUser ? "Redefinir senha" : "Definir senha"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[2px]" onClick={() => !loading && setOpen(false)} />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold text-gray-900 leading-tight">Senha de {driverName}</h2>
                  <p className="text-[11.5px] text-gray-500 mt-1 leading-relaxed">
                    O motorista usa essa senha pra entrar no app móvel com o email cadastrado.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="text-gray-400 hover:text-gray-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-2">
                <label className="block text-[11.5px] font-semibold text-gray-700">Nova senha</label>
                <input
                  type="text"
                  autoFocus
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="mínimo 4 caracteres"
                  disabled={loading || success}
                  className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 outline-none focus:border-orange-400 disabled:opacity-50"
                />
                <p className="text-[10.5px] text-gray-400">
                  Anote num lugar seguro e passe para o motorista.
                </p>
                {error && (
                  <p className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {error}
                  </p>
                )}
                {success && (
                  <p className="text-[11px] text-green-700 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Senha definida com sucesso
                  </p>
                )}
              </div>

              <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
                <button
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || success || pwd.length < 4}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                  Salvar senha
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
