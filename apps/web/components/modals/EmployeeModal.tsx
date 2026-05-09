"use client";

import { useState } from "react";
import { mutate } from "swr";
import { C } from "@/lib/colors";
import { api } from "@/lib/api";
import type { Employee } from "@callflow/shared-types";

interface Props {
  employee?: Employee;
  onClose: () => void;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function EmployeeModal({ employee, onClose }: Props) {
  const isEdit = !!employee;

  const [name,           setName]           = useState(employee?.name  ?? "");
  const [email,          setEmail]          = useState(employee?.email ?? "");
  const [phone,          setPhone]          = useState(employee?.phone ?? "");
  const [role,           setRole]           = useState<"owner" | "employee">("employee");
  const [password,       setPassword]       = useState("");
  const [showPassword,   setShowPassword]   = useState(false);
  const [newPassword,    setNewPassword]    = useState("");
  const [showNewPw,      setShowNewPw]      = useState(false);
  const [showResetPw,    setShowResetPw]    = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState("");

  async function handleSave() {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!isEdit && !password.trim()) {
      setError("Password is required for new employees.");
      return;
    }
    if (isEdit && showResetPw && newPassword.trim() && newPassword.trim().length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name:  name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
      };

      if (!isEdit) {
        payload.role     = role;
        payload.password = password.trim();
      } else if (showResetPw && newPassword.trim()) {
        payload.password = newPassword.trim();
      }

      if (isEdit) {
        await api.patch(`/employees/${employee.id}`, payload);
      } else {
        await api.post("/employees", payload);
      }
      await mutate("/employees");
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const fieldLabel: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 700,
    color: C.muted, textTransform: "uppercase",
    letterSpacing: 0.8, marginBottom: 6,
  };

  const fieldInput: React.CSSProperties = {
    width: "100%", padding: "10px 12px", boxSizing: "border-box",
    background: C.bgDeep, border: `1px solid ${C.border}`,
    borderRadius: 10, fontSize: 13, color: C.text, outline: "none",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.18)", zIndex: 200 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 460, background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 20, padding: "28px 32px",
        boxShadow: C.shadowMd, zIndex: 201,
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <h3 style={{ margin: "0 0 24px", fontSize: 17, fontWeight: 800, color: C.text }}>
          {isEdit ? "Edit Employee" : "Add Employee"}
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Name */}
          <div>
            <label style={fieldLabel}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Full name" style={fieldInput} />
          </div>

          {/* Email */}
          <div>
            <label style={fieldLabel}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com" style={fieldInput} />
          </div>

          {/* Phone */}
          <div>
            <label style={fieldLabel}>Phone (optional)</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210" style={fieldInput} />
          </div>

          {/* Password — Add mode only */}
          {!isEdit && (
            <div>
              <label style={fieldLabel}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  style={{ ...fieldInput, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: C.muted, padding: 4, display: "flex", alignItems: "center",
                  }}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>
          )}

          {/* Role — Add mode only */}
          {!isEdit && (
            <div>
              <label style={fieldLabel}>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as "owner" | "employee")}
                style={fieldInput}>
                <option value="employee">Employee</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          )}

          {/* Reset Password — Edit mode only */}
          {isEdit && (
            <div>
              <button
                type="button"
                onClick={() => { setShowResetPw(v => !v); setNewPassword(""); }}
                style={{
                  background: "none", border: "none", padding: 0,
                  fontSize: 13, fontWeight: 600, color: C.orange,
                  cursor: "pointer", textDecoration: "underline",
                }}
              >
                {showResetPw ? "Cancel password reset" : "Reset password"}
              </button>

              {showResetPw && (
                <div style={{ marginTop: 10 }}>
                  <label style={fieldLabel}>New Password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showNewPw ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      style={{ ...fieldInput, paddingRight: 40 }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(v => !v)}
                      style={{
                        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer",
                        color: C.muted, padding: 4, display: "flex", alignItems: "center",
                      }}
                    >
                      <EyeIcon open={showNewPw} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <p style={{ margin: "16px 0 0", fontSize: 13, color: C.red }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} style={{
            padding: "9px 20px", border: `1px solid ${C.border}`,
            borderRadius: 10, background: C.bgDeep,
            color: C.textSub, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: "9px 20px", border: "none", borderRadius: 10,
            background: saving ? C.dim : C.orange,
            color: "#fff", fontWeight: 700, fontSize: 13,
            cursor: saving ? "not-allowed" : "pointer",
          }}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Employee"}
          </button>
        </div>
      </div>
    </>
  );
}
