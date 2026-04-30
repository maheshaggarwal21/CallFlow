"use client";

import { useRouter } from "next/navigation";

const FEATURES = [
  { icon: "📞", title: "Live Call Tracking",    desc: "Monitor every inbound and outbound call across all lines in real time." },
  { icon: "🤖", title: "AI Transcription",      desc: "Automatic Whisper transcription, speaker diarization, and sentiment scoring." },
  { icon: "📊", title: "Team Analytics",        desc: "Per-agent dashboards, CSAT scores, and month-over-month trends at a glance." },
  { icon: "🔔", title: "Instant Sync",          desc: "KoreCall PBX and Android phone recordings sync automatically via FTP." },
];

export default function LandingPage() {
  const router = useRouter();

  return (
    <div style={{ minHeight: "100vh", background: "#1a1410", color: "#fff", fontFamily: "system-ui, sans-serif" }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "0 24px",
        overflow: "hidden",
        textAlign: "center",
      }}>
        {/* Background image */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "url('/images/maxmusicschool.jpeg')",
          backgroundSize: "cover",
          backgroundPosition: "center 20%",
          filter: "blur(1px) brightness(0.55) saturate(1.1)",
          transform: "scale(1.03)",
        }} />

        {/* Gradient vignette — edges darker, centre shows the photo */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.52) 65%, rgba(0,0,0,0.82) 100%)",
        }} />

        {/* Bottom fade to features section */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 200,
          background: "linear-gradient(to bottom, transparent, #0d0a07)",
        }} />

        {/* Content */}
        <div style={{ position: "relative", zIndex: 1, maxWidth: 680 }}>

          {/* Logo badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            background: "rgba(232,118,26,0.18)", border: "1px solid rgba(232,118,26,0.35)",
            borderRadius: 100, padding: "8px 18px", marginBottom: 36,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg,#e8761a,#f59e0b)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14,
            }}>♪</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f5a94e", letterSpacing: 0.3 }}>
              Max Music School
            </span>
          </div>

          <h1 style={{
            margin: "0 0 20px",
            fontSize: "clamp(42px, 8vw, 72px)",
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1.05,
            color: "#fff",
          }}>
            Call<span style={{ color: "#f59e0b" }}>Flow</span>
          </h1>

          <p style={{
            margin: "0 0 14px",
            fontSize: "clamp(16px, 2.5vw, 22px)",
            color: "rgba(255,255,255,0.75)",
            fontWeight: 400,
            lineHeight: 1.55,
          }}>
            Intelligent call management for music schools.
          </p>
          <p style={{
            margin: "0 0 48px",
            fontSize: "clamp(13px, 1.8vw, 16px)",
            color: "rgba(255,255,255,0.45)",
            lineHeight: 1.6,
          }}>
            Track calls · AI transcription · Team analytics · Live sync
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => router.push("/login")}
              style={{
                padding: "15px 36px", borderRadius: 14, border: "none",
                background: "linear-gradient(135deg,#e8761a,#f59e0b)",
                color: "#fff", fontWeight: 700, fontSize: 16,
                cursor: "pointer",
                boxShadow: "0 8px 32px rgba(232,118,26,0.45)",
                transition: "transform 0.15s, box-shadow 0.15s",
                letterSpacing: 0.2,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 12px 40px rgba(232,118,26,0.55)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 8px 32px rgba(232,118,26,0.45)";
              }}
            >
              Sign In to Dashboard →
            </button>

            <button
              onClick={() => {
                document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                padding: "15px 28px", borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.07)",
                color: "rgba(255,255,255,0.80)", fontWeight: 600, fontSize: 16,
                cursor: "pointer",
                backdropFilter: "blur(8px)",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.30)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
              }}
            >
              Learn More ↓
            </button>
          </div>
        </div>

        {/* Scroll hint */}
        <div style={{
          position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)",
          zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          color: "rgba(255,255,255,0.35)", fontSize: 12,
        }}>
          <div style={{
            width: 22, height: 36, border: "1.5px solid rgba(255,255,255,0.25)",
            borderRadius: 12, display: "flex", justifyContent: "center", paddingTop: 6,
          }}>
            <div style={{
              width: 3, height: 7, background: "rgba(255,255,255,0.45)",
              borderRadius: 4,
              animation: "scrollDot 2s ease-in-out infinite",
            }} />
          </div>
          Scroll
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" style={{
        padding: "100px 24px 80px",
        maxWidth: 1100,
        margin: "0 auto",
      }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 2 }}>
            What CallFlow Does
          </p>
          <h2 style={{ margin: 0, fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 800, color: "#fff", letterSpacing: -1 }}>
            Everything in one place
          </h2>
          <p style={{ margin: "14px auto 0", maxWidth: 480, fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
            From raw PBX recordings to AI-powered insights — CallFlow handles the full call lifecycle.
          </p>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 20,
        }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 20, padding: "28px 26px",
              transition: "border-color 0.2s, background 0.2s",
            }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "rgba(232,118,26,0.07)";
                (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(232,118,26,0.25)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.09)";
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "rgba(232,118,26,0.14)", border: "1px solid rgba(232,118,26,0.20)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, marginBottom: 18,
              }}>{f.icon}</div>
              <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#fff" }}>{f.title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA strip ────────────────────────────────────────────────────── */}
      <section style={{
        margin: "0 24px 80px",
        borderRadius: 24,
        background: "linear-gradient(135deg, rgba(232,118,26,0.18) 0%, rgba(245,158,11,0.12) 100%)",
        border: "1px solid rgba(232,118,26,0.25)",
        padding: "56px 40px",
        textAlign: "center",
        maxWidth: 840,
        marginLeft: "auto",
        marginRight: "auto",
      }}>
        <h2 style={{ margin: "0 0 12px", fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 800, color: "#fff", letterSpacing: -0.8 }}>
          Ready to get started?
        </h2>
        <p style={{ margin: "0 0 32px", fontSize: 16, color: "rgba(255,255,255,0.55)" }}>
          Sign in with your admin or employee credentials to access the dashboard.
        </p>
        <button
          onClick={() => router.push("/login")}
          style={{
            padding: "14px 40px", borderRadius: 13, border: "none",
            background: "linear-gradient(135deg,#e8761a,#f59e0b)",
            color: "#fff", fontWeight: 700, fontSize: 16,
            cursor: "pointer",
            boxShadow: "0 6px 24px rgba(232,118,26,0.40)",
            transition: "transform 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
        >
          Open Dashboard →
        </button>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.07)",
        padding: "24px",
        textAlign: "center",
        color: "rgba(255,255,255,0.25)",
        fontSize: 13,
      }}>
        CallFlow · Max Music School · {new Date().getFullYear()}
      </footer>

      <style>{`
        @keyframes scrollDot {
          0%, 100% { transform: translateY(0); opacity: 0.8; }
          50% { transform: translateY(8px); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
