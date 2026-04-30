"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { LoginResponse } from "@callflow/shared-types";

type Role = "owner" | "employee";

const ROLE_TABS: { key: Role; label: string; icon: string }[] = [
  { key: "owner",    label: "Admin",    icon: "◎" },
  { key: "employee", label: "Employee", icon: "◉" },
];

const DEMO: Record<Role, { email: string; password: string }> = {
  owner:    { email: "admin@maxmusic.in",    password: "Admin@1234" },
  employee: { email: "employee@maxmusic.in", password: "Employee@1234" },
};

export default function LoginPage() {
  const router = useRouter();
  const [role,     setRole]     = useState<Role>("owner");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  function selectRole(r: Role) {
    setRole(r);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/auth/login", { email, password });
      if (res.user.role === "owner") {
        router.push("/dashboard/overview");
      } else {
        router.push(`/dashboard/employees/${res.user.id}`);
      }
    } catch (err: any) {
      setError(err.message ?? "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  const demo = DEMO[role];

  return (
    <div style={{
      minHeight: "100vh",
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      overflow: "hidden",
      background: "#f7f5f0", // site bg colour — visible before image loads
    }}>
      {/* Background image */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "url('/images/your-image.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center 35%",
        filter: "blur(2px) brightness(0.58)",
        transform: "scale(1.04)",
      }} />

      {/* Warm faded overlay — matches site colour palette */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(160deg, rgba(247,242,232,0.18) 0%, rgba(20,14,8,0.45) 100%)",
      }} />

      {/* Card */}
      <div style={{
        position: "relative", zIndex: 1,
        background: "rgba(252,249,244,0.97)", // site card warm-white
        backdropFilter: "blur(24px)",
        borderRadius: 24,
        padding: "40px 44px",
        width: "100%",
        maxWidth: 420,
        boxShadow: "0 24px 64px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.20)",
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56,
            background: "linear-gradient(135deg,#e8761a,#f59e0b)",
            borderRadius: 16, margin: "0 auto 14px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28,
            boxShadow: "0 6px 18px rgba(232,118,26,0.38)",
          }}>♪</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1a1209", letterSpacing: -0.4 }}>
            CallFlow
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#7a6a56", fontWeight: 500 }}>
            Max Music School — Sign in to continue
          </p>
        </div>

        {/* Role tabs */}
        <div style={{
          display: "flex", gap: 6,
          background: "#f5f0eb",
          borderRadius: 14, padding: 4,
          marginBottom: 24,
        }}>
          {ROLE_TABS.map((t) => {
            const active = role === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => selectRole(t.key)}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "10px 0",
                  borderRadius: 10, border: "none",
                  background: active ? "#fff" : "transparent",
                  color: active ? "#e8761a" : "#9a8470",
                  fontWeight: active ? 700 : 500,
                  fontSize: 14, cursor: "pointer",
                  boxShadow: active ? "0 2px 8px rgba(0,0,0,0.10)" : "none",
                  transition: "all 0.16s",
                }}
              >
                <span style={{ fontSize: 13 }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Demo credentials hint */}
        <div style={{
          background: "#fff9f3",
          border: "1px solid #f0dcc8",
          borderRadius: 10, padding: "10px 14px",
          marginBottom: 22,
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ fontSize: 13, marginTop: 1 }}>💡</span>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#b86214", textTransform: "uppercase", letterSpacing: 0.6 }}>
              Demo credentials
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#7a5a3a", fontFamily: "monospace" }}>
              {demo.email}
            </p>
            <p style={{ margin: "1px 0 0", fontSize: 12, color: "#7a5a3a", fontFamily: "monospace" }}>
              {demo.password}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Email */}
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#7a6a56", textTransform: "uppercase", letterSpacing: 0.8 }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={demo.email}
              required
              autoComplete="email"
              style={{
                width: "100%", padding: "11px 14px", boxSizing: "border-box",
                background: "#faf8f5", border: "1.5px solid #e8ddd2",
                borderRadius: 11, fontSize: 14, color: "#1a1209",
                outline: "none", transition: "border-color 0.15s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#e8761a"}
              onBlur={(e) => e.target.style.borderColor = "#e8ddd2"}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#7a6a56", textTransform: "uppercase", letterSpacing: 0.8 }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{
                  width: "100%", padding: "11px 44px 11px 14px", boxSizing: "border-box",
                  background: "#faf8f5", border: `1.5px solid ${error ? "#e05a2b" : "#e8ddd2"}`,
                  borderRadius: 11, fontSize: 14, color: "#1a1209",
                  outline: "none", transition: "border-color 0.15s",
                }}
                onFocus={(e) => e.target.style.borderColor = "#e8761a"}
                onBlur={(e) => e.target.style.borderColor = error ? "#e05a2b" : "#e8ddd2"}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 15, color: "#9a8470", padding: 0, lineHeight: 1,
                }}
              >
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 13, color: "#e05a2b", fontWeight: 600 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "13px 0", marginTop: 6,
              background: loading
                ? "#c8a880"
                : "linear-gradient(135deg,#e8761a,#f59e0b)",
              border: "none", borderRadius: 12,
              color: "#fff", fontWeight: 700, fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: loading ? "none" : "0 6px 20px rgba(232,118,26,0.40)",
              transition: "all 0.15s",
              letterSpacing: 0.2,
            }}
          >
            {loading ? "Signing in…" : "Sign In →"}
          </button>
        </form>

        <p style={{ margin: "20px 0 0", fontSize: 12, color: "#b8a898", textAlign: "center" }}>
          CallFlow · Max Music School Call Management
        </p>
      </div>
    </div>
  );
}
