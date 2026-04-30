"use client";

interface Props {
  phone: string | null;
  size?: "sm" | "md";
}

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm5.04 13.886c-.21.588-1.236 1.126-1.69 1.168-.454.042-.44.336-2.772-.638-2.332-.974-3.738-3.374-3.85-3.526-.112-.152-.924-1.274-.878-2.408.046-1.134.636-1.68.862-1.908.226-.228.492-.286.656-.29.164-.004.328 0 .472.006.152.006.356-.058.556.424.2.482.68 1.664.74 1.784.06.12.1.26.02.416-.08.156-.12.252-.24.388-.12.136-.252.304-.36.408-.12.114-.244.238-.106.468.138.23.614.988 1.318 1.6.906.8 1.67 1.048 1.9 1.164.23.116.364.098.5-.042.136-.14.584-.672.74-.902.156-.23.312-.19.524-.112.212.078 1.344.624 1.574.738.23.114.384.17.44.266.056.096.056.556-.154 1.144z" />
    </svg>
  );
}

export default function WABtn({ phone, size = "md" }: Props) {
  if (!phone || phone === "Unknown") return null;

  const digits = phone.replace(/\D/g, "");
  const isSmall = size === "sm";

  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in WhatsApp"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        width: isSmall ? 26 : 32,
        height: isSmall ? 26 : 32,
        background: "#25D366",
        borderRadius: isSmall ? 7 : 9,
        color: "#fff",
        textDecoration: "none",
        flexShrink: 0,
        boxShadow: "0 1px 4px rgba(37,211,102,0.3)",
      }}
    >
      <WhatsAppIcon size={isSmall ? 13 : 16} />
    </a>
  );
}

export function WAIconInline({ phone }: { phone: string | null }) {
  if (!phone || phone === "Unknown") return null;
  const digits = phone.replace(/\D/g, "");
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 6,
        background: "#25D366",
        color: "#fff",
        textDecoration: "none",
        flexShrink: 0,
      }}
    >
      <WhatsAppIcon size={12} />
    </a>
  );
}
