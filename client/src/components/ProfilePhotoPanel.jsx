import React, { useRef, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import { Badge } from "./UI.jsx";
import { ProtectedImage } from "./ProtectedImage.jsx";
import { apiFetch } from "../context/api.js";

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Student-facing upload card. `photos` is the GET /photos/me payload owned by
// the parent page (so the hero avatar and this panel stay in sync).
export function ProfilePhotoPanel({ photos, onChanged }) {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const maxBytes = photos?.maxFileBytes || 2 * 1024 * 1024;

  function pick(event) {
    const chosen = event.target.files?.[0] || null;
    if (chosen && chosen.size > maxBytes) {
      setMessage(`That photo is too large (limit ${formatSize(maxBytes)}).`);
      setMessageType("error");
      event.target.value = "";
      setFile(null);
      return;
    }
    setMessage("");
    setFile(chosen);
  }

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const data = await apiFetch("/photos/me", { method: "POST", body });
      setMessage(data.message);
      setMessageType("success");
      setFile(null);
      if (input.current) input.current.value = "";
      await onChanged();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await apiFetch("/photos/me/pending", { method: "DELETE" });
      setMessage("Submission withdrawn.");
      setMessageType("success");
      await onChanged();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  const { approved, pending, rejected } = photos || {};

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Profile photo</span>
          <h2>Your photo</h2>
        </div>
        <Camera size={22} />
      </div>
      <div className="photo-panel-grid">
        <div className="photo-slot">
          <ProtectedImage photoId={approved?.id} alt="Your approved profile photo" className="photo-preview" fallback={<div className="photo-preview photo-empty">No approved photo</div>} />
          <Badge value={approved ? "approved" : "none"} />
        </div>
        {pending && (
          <div className="photo-slot">
            <ProtectedImage photoId={pending.id} alt="Your photo awaiting approval" className="photo-preview" fallback={<div className="photo-preview photo-empty">Preview unavailable</div>} />
            <Badge value="pending" />
            <button className="secondary-button small danger-text" type="button" onClick={withdraw} disabled={busy}>
              <Trash2 size={14} /> Withdraw
            </button>
          </div>
        )}
      </div>
      {pending && <p className="library-hint">Awaiting admin review. Your approved photo (if any) stays live until this one is approved.</p>}
      {rejected && (
        <div role="status" className="error-box">
          Your last photo was rejected: {rejected.rejectionReason || "no reason given"}. Please upload a different one.
        </div>
      )}
      <form className="admin-form" onSubmit={upload}>
        <label className="span-two">
          {pending ? "Replace pending photo" : "Upload a new photo"} (PNG or JPEG, up to {formatSize(maxBytes)})
          <input ref={input} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={pick} required />
        </label>
        <button className="primary-button" type="submit" disabled={busy || !file}>
          <Upload size={17} /> {busy ? "Working…" : "Submit for approval"}
        </button>
      </form>
      {message && (
        <div role="status" className={messageType === "error" ? "error-box" : "success-box"}>
          {message}
        </div>
      )}
    </section>
  );
}
