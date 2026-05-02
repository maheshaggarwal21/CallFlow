"use client";

import { useRef, useState, useEffect } from "react";
import { C, fmtS } from "@/lib/colors";

interface Props {
  url: string | null;
  /** Stable ID (e.g. call UUID) used as the sessionStorage key.
   *  Must NOT be the URL — presigned URLs change on every fetch. */
  storageId?: string;
}

function storageKey(id: string) {
  return `audio-pos:${id}`;
}

export default function AudioPlayer({ url, storageId }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  // Track position in a ref so the beforeunload/cleanup handler always has the latest value
  const currentRef = useRef(0);

  // When URL changes: reset state, restore any saved position for this URL
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    currentRef.current = 0;
    setDuration(0);
  }, [url]);

  // Restore saved position once metadata is loaded (duration known)
  function handleMetadata() {
    const el = audioRef.current;
    if (!el || !storageId) return;
    setDuration(el.duration ?? 0);
    const saved = sessionStorage.getItem(storageKey(storageId));
    if (saved) {
      const t = parseFloat(saved);
      if (t > 0 && t < el.duration - 1) {
        el.currentTime = t;
        setCurrent(t);
        currentRef.current = t;
      }
    }
  }

  function handleTimeUpdate() {
    const el = audioRef.current;
    if (!el) return;
    setCurrent(el.currentTime);
    currentRef.current = el.currentTime;
    if (storageId) sessionStorage.setItem(storageKey(storageId), String(el.currentTime));
  }

  function handleEnded() {
    setPlaying(false);
    if (storageId) sessionStorage.removeItem(storageKey(storageId));
  }

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      await el.play().catch(() => {});
      setPlaying(true);
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(e.target.value);
    el.currentTime = t;
    setCurrent(t);
    currentRef.current = t;
    if (storageId) sessionStorage.setItem(storageKey(storageId), String(t));
  }

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
        onLoadedMetadata={handleMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
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
