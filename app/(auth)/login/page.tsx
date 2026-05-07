"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(data: LoginForm) {
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "Erro ao fazer login");
        return;
      }

      window.location.href = "/dashboard";
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
  }

  return (
    <>
      <style>{`
        .login-root { font-family: var(--font-dm-sans), sans-serif; }
        .brand-font { font-family: var(--font-syne), sans-serif; }

        .dot-grid {
          background-image: radial-gradient(circle, #ffffff0a 1px, transparent 1px);
          background-size: 28px 28px;
        }

        .diagonal-hatch {
          background: repeating-linear-gradient(
            -52deg,
            transparent,
            transparent 12px,
            rgba(249,115,22,0.03) 12px,
            rgba(249,115,22,0.03) 24px
          );
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .anim-up   { animation: slideUp 0.6s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-fade { animation: fadeIn 1s ease both; }

        .left-panel { display: none; }
        @media (min-width: 1024px) { .left-panel { display: flex; } }
        .d1 { animation-delay: 0.08s; }
        .d2 { animation-delay: 0.16s; }
        .d3 { animation-delay: 0.24s; }
        .d4 { animation-delay: 0.36s; }
        .d5 { animation-delay: 0.48s; }

        .field-input {
          width: 100%;
          box-sizing: border-box;
          padding: 12px 16px;
          background: #181818;
          border: 1px solid #2b2b2b;
          border-radius: 6px;
          color: #e0e0e0;
          font-size: 14px;
          font-family: var(--font-dm-sans), sans-serif;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .field-input::placeholder { color: #484848; }
        .field-input:focus {
          outline: none;
          border-color: #f97316;
          box-shadow: 0 0 0 3px rgba(249,115,22,0.12);
        }

        .submit-btn {
          width: 100%;
          padding: 13px;
          background: #f97316;
          border: none;
          border-radius: 6px;
          color: #fff;
          font-family: var(--font-syne), sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.2s, transform 0.1s;
        }
        .submit-btn:hover:not(:disabled) {
          background: #ea6c0a;
          transform: translateY(-1px);
        }
        .submit-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .submit-btn svg { animation: spin 1s linear infinite; }
      `}</style>

      <div
        className="login-root"
        style={{ minHeight: '100vh', display: 'flex', background: '#0d0d0d' }}
      >
        {/* ── Left decorative panel ── */}
        <div
          className="left-panel dot-grid diagonal-hatch anim-fade"
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: 0 }}>
            {/* Orange glow */}
            <div style={{
              position: 'absolute', top: '-5%', left: '-10%',
              width: '70%', height: '60%',
              background: 'radial-gradient(ellipse, rgba(249,115,22,0.14) 0%, transparent 70%)',
              filter: 'blur(60px)',
            }} />

            {/* Geometric grid illustration */}
            <svg
              viewBox="0 0 520 640"
              style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '78%', maxWidth: '460px' }}
            >
              {/* Accent lines */}
              <rect x="48" y="76"  width="300" height="6" rx="2" fill="#f97316" opacity="0.9" />
              <rect x="48" y="90"  width="180" height="4" rx="2" fill="#f97316" opacity="0.45" />
              <rect x="48" y="104" width="100" height="3" rx="2" fill="#f97316" opacity="0.2" />
              <rect x="48" y="56"  width="4" height="320" rx="2" fill="#f97316" opacity="0.75" />

              {/* Outer frame */}
              <rect x="64" y="134" width="370" height="280" rx="3" fill="none" stroke="#f97316" strokeWidth="1" opacity="0.1" />

              {/* Inner blocks — warehouse grid metaphor */}
              <rect x="84" y="154" width="110" height="90" rx="2" fill="#f97316" opacity="0.07" />
              <rect x="204" y="154" width="70"  height="90" rx="2" fill="#f97316" opacity="0.12" />
              <rect x="284" y="154" width="130" height="90" rx="2" fill="#f97316" opacity="0.05" />

              <rect x="84" y="254" width="160" height="120" rx="2" fill="#f97316" opacity="0.05" />
              <rect x="254" y="254" width="160" height="120" rx="2" fill="#f97316" opacity="0.09" />

              {/* Dividers inside blocks */}
              <line x1="84"  y1="199" x2="194" y2="199" stroke="#f97316" strokeWidth="0.8" opacity="0.15" />
              <line x1="254" y1="314" x2="414" y2="314" stroke="#f97316" strokeWidth="0.8" opacity="0.12" />

              {/* Status dots */}
              <circle cx="94"  cy="169" r="4" fill="#f97316" opacity="0.7" />
              <circle cx="109" cy="169" r="4" fill="#f97316" opacity="0.35" />
              <circle cx="124" cy="169" r="4" fill="#f97316" opacity="0.15" />

              <circle cx="264" cy="169" r="4" fill="#f97316" opacity="0.8" />
              <circle cx="279" cy="169" r="4" fill="#f97316" opacity="0.4" />

              {/* Bottom accent */}
              <rect x="48" y="438" width="430" height="2" rx="1" fill="#f97316" opacity="0.18" />
              <rect x="48" y="448" width="220" height="2" rx="1" fill="#f97316" opacity="0.1" />

              {/* Label-like tags */}
              <rect x="84"  y="460" width="60" height="18" rx="2" fill="#f97316" opacity="0.06" />
              <rect x="154" y="460" width="40" height="18" rx="2" fill="#f97316" opacity="0.04" />
              <rect x="204" y="460" width="80" height="18" rx="2" fill="#f97316" opacity="0.08" />
            </svg>

            {/* Brand corner label */}
            <div style={{ position: 'absolute', bottom: '44px', left: '48px' }}>
              <p className="brand-font" style={{ color: '#f97316', fontSize: '10px', letterSpacing: '0.22em', textTransform: 'uppercase', opacity: 0.75, marginBottom: '4px' }}>
                Mestre da Pintura
              </p>
              <p style={{ color: '#383838', fontSize: '12px' }}>Sistema de Gestão Logística</p>
            </div>
          </div>
        </div>

        {/* ── Right login panel ── */}
        <div
          style={{
            width: '100%',
            maxWidth: '460px',
            minWidth: 'min(100%, 460px)',
            background: '#111111',
            borderLeft: '1px solid #1c1c1c',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '64px 48px',
            position: 'relative',
          }}
        >
          {/* Top orange bar */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
            background: 'linear-gradient(90deg, #f97316 0%, #fb923c 60%, transparent 100%)',
          }} />

          <div style={{ maxWidth: '340px', margin: '0 auto', width: '100%' }}>

            {/* Logo + heading */}
            <div className="anim-up" style={{ marginBottom: '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
                <div style={{
                  width: '38px', height: '38px',
                  background: '#f97316',
                  borderRadius: '7px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="9,22 9,12 15,12 15,22" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="brand-font" style={{ color: '#d4d4d4', fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em' }}>
                  LOGÍSTICA
                </span>
              </div>

              <h1 className="brand-font" style={{ color: '#f0f0f0', fontSize: '26px', fontWeight: 800, lineHeight: 1.2, marginBottom: '8px' }}>
                Acesse o sistema
              </h1>
              <p style={{ color: '#4a4a4a', fontSize: '13px', lineHeight: 1.6 }}>
                Controle de fretes, entregas e transferências
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="anim-up d1">
                <label style={{
                  display: 'block', color: '#666', fontSize: '10px',
                  letterSpacing: '0.15em', textTransform: 'uppercase',
                  fontWeight: 500, marginBottom: '8px',
                }}>
                  E-mail
                </label>
                <input
                  {...register("email")}
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.com"
                  className="field-input"
                />
                {errors.email && (
                  <p style={{ marginTop: '6px', fontSize: '12px', color: '#f87171' }}>{errors.email.message}</p>
                )}
              </div>

              <div className="anim-up d2">
                <label style={{
                  display: 'block', color: '#666', fontSize: '10px',
                  letterSpacing: '0.15em', textTransform: 'uppercase',
                  fontWeight: 500, marginBottom: '8px',
                }}>
                  Senha
                </label>
                <input
                  {...register("password")}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="field-input"
                />
                {errors.password && (
                  <p style={{ marginTop: '6px', fontSize: '12px', color: '#f87171' }}>{errors.password.message}</p>
                )}
              </div>

              {error && (
                <div className="anim-up" style={{
                  background: 'rgba(239,68,68,0.07)',
                  border: '1px solid rgba(239,68,68,0.18)',
                  borderRadius: '6px', padding: '12px 16px',
                }}>
                  <p style={{ fontSize: '13px', color: '#f87171' }}>{error}</p>
                </div>
              )}

              <div className="anim-up d3">
                <button type="submit" disabled={isSubmitting} className="submit-btn">
                  {isSubmitting && <Loader2 width={15} height={15} />}
                  {isSubmitting ? "Entrando..." : "Entrar"}
                </button>
              </div>
            </form>

            <p className="anim-up d5" style={{
              marginTop: '48px', fontSize: '11px',
              color: '#2a2a2a', textAlign: 'center', letterSpacing: '0.05em',
            }}>
              Atual Comércio de Tintas · Sistema interno
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
