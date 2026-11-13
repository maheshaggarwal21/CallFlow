// Small line icons for the lead sheet (1.6px stroke, currentColor), so no icon library is needed.
import type { CSSProperties } from "react";

const P: Record<string, string> = {
  phone: "M5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3l1.2-2L20 14v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  megaphone: "M3 10v4h3l6 4V6L6 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
  chat: "M4 5h16v11H9l-5 4z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  chart: "M5 20V10M12 20V4M19 20v-7",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  retry: "M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  note: "M5 4h14v16H5zM8 9h8M8 13h8M8 17h5",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  check: "M5 12l4 4 10-10",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  open: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
};

export function Icon({ name, size = 16, style }: { name: keyof typeof P; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", ...style }}>
      <path d={P[name]} />
    </svg>
  );
}
