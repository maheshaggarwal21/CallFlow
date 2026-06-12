"use client";

import { useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { C } from "@/lib/colors";
import { fmtDateLong } from "@/lib/datetime";
import { api, fetcher } from "@/lib/api";
import type { Student } from "@callflow/shared-types";

export default function StudentsPage() {
  const { data: students, isLoading } = useSWR<Student[]>("/students", fetcher);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [editing, setEditing] = useState<Student | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = (students ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.phone.includes(search)
  );

  async function handleImport(file: File) {
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.postForm<{ imported: number; skipped: number; errors: string[] }>(
        "/students/import",
        form
      );
      setImportResult(res);
      await mutate("/students");
    } catch (err: any) {
      setImportError(err.message ?? "Import failed.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openEdit(student: Student) {
    setEditing(student);
    setEditName(student.name);
    setEditPhone(student.phone);
    setEditNotes(student.notes ?? "");
    setEditError("");
  }

  async function handleSaveEdit() {
    if (!editing) return;
    if (!editName.trim() || !editPhone.trim()) {
      setEditError("Name and phone are required.");
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      await api.patch(`/students/${editing.id}`, {
        name: editName.trim(),
        phone: editPhone.trim(),
        notes: editNotes.trim() || null,
      });
      await mutate("/students");
      setEditing(null);
    } catch (err: any) {
      setEditError(err.message ?? "Failed to update.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(student: Student) {
    const ok = window.confirm(`Delete ${student.name}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.delete(`/students/${student.id}`);
      await mutate("/students");
    } catch (err: any) {
      setImportError(err.message ?? "Delete failed.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>Students</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.muted }}>
            Student contact list — {(students ?? []).length} entries
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            style={{
              padding: "8px 14px",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              background: C.card,
              color: C.textSub,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {importing ? "Importing..." : "Import CSV"}
          </button>
        </div>
      </div>

      {importError && (
        <p style={{ margin: 0, fontSize: 13, color: C.red }}>
          {importError}
        </p>
      )}
      {importResult && (
        <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
          Imported {importResult.imported}, skipped {importResult.skipped}
          {importResult.errors.length > 0 ? ` — ${importResult.errors.length} errors` : ""}
        </p>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          padding: "10px 16px", width: "100%", boxSizing: "border-box",
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, fontSize: 14, color: C.text, outline: "none",
        }}
      />

      {/* Table */}
      {isLoading ? (
        <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: 48, textAlign: "center",
          color: C.muted, fontSize: 14,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        }}>
          {search ? "No students match your search." : "No students yet."}
        </div>
      ) : (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16, overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Phone", "Notes", "Added", ""].map((h) => (
                  <th key={h} style={{
                    padding: "10px 16px",
                    fontSize: 11, fontWeight: 700, color: C.muted,
                    textTransform: "uppercase", letterSpacing: 0.8,
                    textAlign: "left", borderBottom: `1px solid ${C.border}`,
                    background: C.bgDeep,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: C.text }}>
                    {s.name}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: C.textSub, fontFamily: "monospace" }}>
                    {s.phone}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: C.muted }}>
                    {s.notes ?? <span style={{ color: C.dim }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: C.muted }}>
                    {fmtDateLong(s.created_at)}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => openEdit(s)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: `1px solid ${C.border}`,
                          background: C.card,
                          color: C.textSub,
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >Edit</button>
                      <button
                        onClick={() => handleDelete(s)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: `1px solid ${C.redBdr}`,
                          background: C.redLight,
                          color: C.red,
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <>
          <div onClick={() => setEditing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.18)", zIndex: 200 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 420, background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 20, padding: "28px 32px",
            boxShadow: C.shadowMd, zIndex: 201,
          }}>
            <h3 style={{ margin: "0 0 18px", fontSize: 17, fontWeight: 800, color: C.text }}>Edit Student</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                  Name
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bgDeep }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                  Phone
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bgDeep }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                  Notes
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bgDeep, resize: "vertical" }}
                />
              </div>
            </div>

            {editError && <p style={{ margin: "12px 0 0", fontSize: 13, color: C.red }}>{editError}</p>}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button
                onClick={() => setEditing(null)}
                style={{ padding: "9px 18px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.bgDeep, color: C.textSub, fontWeight: 600, fontSize: 13 }}
              >Cancel</button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                style={{ padding: "9px 18px", border: "none", borderRadius: 10, background: saving ? C.dim : C.orange, color: "#fff", fontWeight: 700, fontSize: 13 }}
              >{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
