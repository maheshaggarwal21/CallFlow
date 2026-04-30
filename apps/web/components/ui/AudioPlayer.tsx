"use client";

import { useRef, useState, useEffect } from "react";
import { C, fmtS } from "@/lib/colors";

interface Props {
  url: string | null;
}

export default function AudioPlayer({ url }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [url]);

  if (!url) {
    return (
      <div
        style={{
          padding: "14px 18px",
          background: C.bgDeep,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: C.muted,
          fontSize: 13,
        }}
      >
        <span style={{ fontSize: 18 }}>🔇</span>
        Audio not available
      </div>
    );
  }

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      await el.play();
    }
    setPlaying(!playing);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
    setCurrent(Number(e.target.value));
  }

  return (
    <div
      style={{
        padding: "14px 18px",
        background: C.bgDeep,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
      }}
    >
      <audio
        ref={audioRef}
        src={url}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={togglePlay}
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            flexShrink: 0,
            background: C.orange,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 16,
            boxShadow: "0 2px 8px rgba(232,118,26,0.28)",
          }}
        >
          {playing ? "⏸" : "▶"}
        </button>

        <div style={{ flex: 1 }}>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.5}
            value={current}
            onChange={handleSeek}
            style={{
              width: "100%",
              accentColor: C.orange,
              cursor: "pointer",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: C.muted }}>{fmtS(Math.floor(current))}</span>
            <span style={{ fontSize: 11, color: C.muted }}>{fmtS(Math.floor(duration))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
