"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/colors";
import { api } from "@/lib/api";
import type { LoginResponse } from "@callflow/shared-types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPwd, setShowPwd]       = useState(false);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);

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

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: C.bg,
      padding: 24,
    }}>
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 24,
        padding: "40px 44px",
        width: "100%",
        maxWidth: 420,
        boxShadow: C.shadowMd,
      }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
          <div style={{
            width: 48, height: 48,
            background: "linear-gradient(135deg,#e8761a,#f59e0b)",
            borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
            boxShadow: "0 3px 10px rgba(232,118,26,0.32)",
          }}>♪</div>
          <div>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
              CallFlow
            </p>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 500 }}>
              Max Music School
            </p>
          </div>
        </div>

        <p style={{ margin: "0 0 28px", fontSize: 15, color: C.muted }}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Email */}
          <div>
            <p style={{ margin: "0 0 7px", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
              Email
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={{
                width: "100%", padding: "12px 14px",
                background: C.bgDeep, border: `1px solid ${C.border}`,
                borderRadius: 12, fontSize: 14, color: C.text,
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Password */}
          <div>
            <p style={{ margin: "0 0 7px", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
              Password
            </p>
            <div style={{ position: "relative" }}>
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{
                  width: "100%", padding: "12px 44px 12px 14px",
                  background: C.bgDeep, border: `1px solid ${error ? C.red : C.border}`,
                  borderRadius: 12, fontSize: 14, color: C.text,
                  outline: "none", boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 16, color: C.muted, padding: 0, lineHeight: 1,
                }}
                title={showPwd ? "Hide password" : "Show password"}
              >
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 13, color: C.red, fontWeight: 500 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "13px 0", marginTop: 8,
              background: loading ? C.dim : C.orange,
              border: "none", borderRadius: 12,
              color: "#fff", fontWeight: 700, fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: loading ? "none" : "0 4px 14px rgba(232,118,26,0.32)",
              transition: "all 0.15s",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
