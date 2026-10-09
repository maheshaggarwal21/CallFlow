"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { C } from "@/lib/colors";
import { api, fetcher } from "@/lib/api";
import Card from "@/components/ui/Card";
import type { AudioFormat, SystemSettings } from "@callflow/shared-types";

const FORMAT_OPTIONS: {
  value: AudioFormat;
  title: string;
  badge?: string;
  desc: string;
  mime: string;
}[] = [
  {
    value: "opus",
    title: "Opus · 16 kbps",
    badge: "Recommended",
    desc: "Built for voice calls — slightly clearer at the same size. Browsers that can't play Opus get an MP3 copy automatically.",
    mime: 'audio/webm; codecs="opus"',
  },
  {
    value: "mp3",
    title: "MP3 · 16 kbps",
    desc: "Plays on every browser and phone without conversion. Anyone who picks Opus in the player gets it converted on demand.",
    mime: "audio/mpeg",
  },
];

export default function SettingsPage() {
  const { data, isLoading, mutate } = useSWR<SystemSettings>("/system/settings", fetcher);
  const [saving, setSaving] = useState<AudioFormat | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Which formats THIS browser can play — computed client-side after mount
  const [playable, setPlayable] = useState<Record<AudioFormat, boolean> | null>(null);

  useEffect(() => {
    const probe = document.createElement("audio");
    setPlayable({
      mp3: probe.canPlayType("audio/mpeg") !== "",
      opus: probe.canPlayType('audio/webm; codecs="opus"') !== "",
    });
  }, []);

  async function choose(format: AudioFormat) {
    if (format === data?.audio_format || saving) return;
    setSaving(format);
    setMessage(null);
    try {
      const updated = await api.patch<SystemSettings>("/system/settings", { audio_format: format });
      await mutate(updated, { revalidate: false });
      setMessage({ ok: true, text: "Saved. New recordings will be stored in this format." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message || "Could not save setting." });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 820 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>Settings</h1>
        <p style={{ margin: "5px 0 0", fontSize: 15, color: C.muted }}>System preferences for Max Music School</p>
      </div>

      <Card>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Recording format</h2>
        <p style={{ margin: "6px 0 18px", fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
          Call recordings are compressed to about a quarter of their original size before being stored.
          This keeps 90 days of calls inside the free storage limit. Both options sound like a normal phone call, and anyone can still switch format per call from the ⋯ menu on the player.
        </p>

        {isLoading ? (
          <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {FORMAT_OPTIONS.map((opt) => {
              const selected = data?.audio_format === opt.value;
              const canPlay  = playable?.[opt.value];
              return (
                <button
                  key={opt.value}
                  onClick={() => choose(opt.value)}
                  disabled={saving !== null}
                  aria-pressed={selected}
                  style={{
                    textAlign: "left", padding: "16px 18px", borderRadius: 14,
                    border: `1.5px solid ${selected ? C.orange : C.border}`,
                    background: selected ? C.orangeLight : C.card,
                    cursor: saving ? "wait" : selected ? "default" : "pointer",
                    display: "flex", flexDirection: "column", gap: 8,
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                      border: `2px solid ${selected ? C.orange : C.dim}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {selected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.orange }} />}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{opt.title}</span>
                    {opt.badge && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: C.green,
                        background: C.greenLight, border: `1px solid ${C.greenBdr}`,
                        borderRadius: 8, padding: "1px 8px",
                      }}>{opt.badge}</span>
                    )}
                    {saving === opt.value && <span style={{ fontSize: 12, color: C.muted }}>Saving…</span>}
                  </div>
                  <span style={{ fontSize: 13, color: C.textSub, lineHeight: 1.5 }}>{opt.desc}</span>
                  {playable && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: canPlay ? C.green : C.red }}>
                      {canPlay ? "✓ Plays in this browser" : "✗ This browser can't play this format"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {message && (
          <p style={{ margin: "14px 0 0", fontSize: 13, fontWeight: 600, color: message.ok ? C.green : C.red }}>
            {message.text}
          </p>
        )}

        <p style={{ margin: "16px 0 0", fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Changes apply to calls uploaded from now on. Recordings already stored keep their current format.
        </p>
      </Card>
    </div>
  );
}
