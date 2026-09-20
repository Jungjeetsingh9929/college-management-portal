import React, { useEffect, useState } from "react";
import { ExternalLink, Mail, Phone, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../context/api.js";
import { ProfilePhotoPanel } from "../components/ProfilePhotoPanel.jsx";
import { ProtectedImage } from "../components/ProtectedImage.jsx";
import { PROFILE_LIMITS, addSkills, draftFromUser, draftPayload, profileCompleteness, safeProfileUrl, validateDraft } from "../utils/profileValidation.js";

const PROFILE_FORM_ID = "profile-edit-form";

function FieldError({ id, message }) {
  return message ? <span id={id} className="field-error" role="alert">{message}</span> : null;
}

export function StudentProfile() {
  const { user, updateUser } = useAuth();
  const [requestedStatus, setRequestedStatus] = useState(user.approvalStatus || "approved");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // One draft + one save flow for every editable profile field (phone,
  // guardian, About me, emergency contact). Older records without the newer
  // fields fall back to empty values via draftFromUser().
  const [draft, setDraft] = useState(() => draftFromUser(user));
  const [pendingSkill, setPendingSkill] = useState("");
  const [skillNotice, setSkillNotice] = useState("");
  const [serverErrors, setServerErrors] = useState({});
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });
  const saving = saveState.status === "saving";
  const [photos, setPhotos] = useState(null);
  async function loadPhotos() {
    setPhotos(await apiFetch("/photos/me"));
  }
  useEffect(() => {
    loadPhotos().catch(() => {});
  }, []);
  const fieldErrors = { ...serverErrors, ...validateDraft(draft) };
  if (skillNotice) fieldErrors.skills = skillNotice;
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const dirty = pendingSkill.trim() !== "" || JSON.stringify(draftPayload(draft)) !== JSON.stringify(draftPayload(draftFromUser(user)));
  const completeness = profileCompleteness(user, Boolean(photos?.approved));
  const linkedinHref = safeProfileUrl(user.linkedin, "linkedin");
  const githubHref = safeProfileUrl(user.github, "github");

  function setField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => { if (!(field in current)) return current; const { [field]: _removed, ...rest } = current; return rest; });
    if (field === "skills") setSkillNotice("");
    setSaveState((current) => (current.status === "saving" ? current : { status: "idle", message: "" }));
  }

  function commitSkill() {
    if (!pendingSkill.trim()) return true;
    const result = addSkills(draft.skills, pendingSkill);
    if (result.error) { setSkillNotice(result.error); return false; }
    setField("skills", result.skills);
    setPendingSkill("");
    return true;
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (saving) return;
    const added = addSkills(draft.skills, pendingSkill);
    if (added.error) { setSkillNotice(added.error); setSaveState({ status: "error", message: "Please fix the highlighted fields." }); return; }
    const next = { ...draft, skills: added.skills };
    if (Object.keys(validateDraft(next)).length) { setSaveState({ status: "error", message: "Please fix the highlighted fields." }); return; }
    setSaveState({ status: "saving", message: "" });
    setServerErrors({});
    try {
      const data = await apiFetch("/students/me/profile", { method: "PUT", body: JSON.stringify(draftPayload(next)) });
      updateUser(data.student);
      setDraft(draftFromUser(data.student));
      setPendingSkill("");
      setSkillNotice("");
      setSaveState({ status: "success", message: "Profile saved." });
    } catch (err) {
      if (err.details?.field) setServerErrors({ [err.details.field]: err.message });
      setSaveState({ status: "error", message: err.message || "Could not save your profile." });
    }
  }

  const details = [
    ["Roll number", user.rollNumber],
    ["Class", user.className],
    ["Department", user.department],
    ["Graduation year", user.graduationYear || "-"],
    ["Approval status", user.approvalStatus || "approved"],
    ["Guardian", user.guardian || "-"]
  ];

  return (
    <div className="page-stack">
      <section className="profile-hero panel">
        <div className="avatar-lg">
          <ProtectedImage photoId={photos?.approved?.id} alt="" className="avatar-photo" fallback={<UserRound size={42} />} />
        </div>
        <div>
          <span className="eyebrow">Student profile</span>
          <h2>{user.name}</h2>
          <p>{user.rollNumber} · {user.department}</p>
        </div>
      </section>
      <section className="panel profile-completeness" aria-labelledby="profile-completeness-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Profile completeness</span>
            <h2 id="profile-completeness-title">{completeness.percent}% complete</h2>
          </div>
        </div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness.percent} aria-label="Profile completeness">
          <span style={{ width: `${completeness.percent}%` }} />
        </div>
        <ul className="completeness-list">
          {completeness.items.map((item) => (
            <li key={item.label} className={item.done ? "done" : ""}>{item.done ? "✓" : "○"} {item.label}</li>
          ))}
        </ul>
      </section>
      <ProfilePhotoPanel photos={photos} onChanged={loadPhotos} />
      <section className="profile-grid">
        <article className="panel">
          <h2>Academic details</h2>
          <div className="detail-list">
            {details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            <div className="status-request-box">
              <h3>Update approval status</h3>
              <p className="helper-text">The administration makes the final approval decision. You can submit a review request from here.</p>
              <form className="form-stack" onSubmit={async (event) => {
                event.preventDefault();
                setMessage("");
                setError("");
                try {
                  const data = await apiFetch("/students/me/status-request", {
                    method: "POST",
                    body: JSON.stringify({ requestedStatus, reason })
                  });
                  setMessage(data.message);
                  setReason("");
                } catch (err) {
                  setError(err.message);
                }
              }}>
                <label>
                  Requested status
                  <select value={requestedStatus} onChange={(event) => setRequestedStatus(event.target.value)}>
                    <option value="pending">Pending review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
                <label>
                  Reason
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why your status should be reviewed" required />
                </label>
                <button className="primary-button" type="submit">Update approval status</button>
              </form>
              {message && <div role="status" className="success-box">{message}</div>}
              {error && <div role="alert" className="error-box">{error}</div>}
            </div>
            <p className="helper-text">You can also <Link to="/complaints">contact the administration through Complaints.</Link></p>
          </div>
        </article>
        <article className="panel">
          <h2>Contact & permitted edits</h2>
          <div className="contact-row"><Mail size={18} /> {user.email}</div>
          <div className="form-stack">
            <label>Phone<input form={PROFILE_FORM_ID} value={draft.phone} onChange={(event) => setField("phone", event.target.value)} maxLength={PROFILE_LIMITS.phone} placeholder="Add a phone number" aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "err-phone" : undefined} disabled={saving} /></label>
            <FieldError id="err-phone" message={fieldErrors.phone} />
            <label>Guardian<input form={PROFILE_FORM_ID} value={draft.guardian} onChange={(event) => setField("guardian", event.target.value)} maxLength={PROFILE_LIMITS.guardian} placeholder="Guardian name" aria-invalid={Boolean(fieldErrors.guardian)} aria-describedby={fieldErrors.guardian ? "err-guardian" : undefined} disabled={saving} /></label>
            <FieldError id="err-guardian" message={fieldErrors.guardian} />
          </div>
        </article>
      </section>
      <section className="profile-grid">
        <article className="panel">
          <h2>About me</h2>
          <div className="form-stack">
            <label>Bio
              <textarea form={PROFILE_FORM_ID} value={draft.bio} onChange={(event) => setField("bio", event.target.value)} rows={4} placeholder="A short introduction (max 300 characters)" aria-invalid={Boolean(fieldErrors.bio)} aria-describedby={fieldErrors.bio ? "err-bio" : "bio-count"} disabled={saving} />
            </label>
            <span id="bio-count" className="helper-text">{draft.bio.length}/{PROFILE_LIMITS.bio}</span>
            <FieldError id="err-bio" message={fieldErrors.bio} />
            <div className="skills-field">
              <label htmlFor="skill-input">Skills <span className="helper-text">({draft.skills.length}/{PROFILE_LIMITS.skillCount})</span></label>
              <div className="chip-input" aria-invalid={Boolean(fieldErrors.skills)}>
                {draft.skills.map((skill) => (
                  <span className="skill-chip" key={skill}>
                    {skill}
                    <button type="button" aria-label={`Remove skill ${skill}`} disabled={saving} onClick={() => setField("skills", draft.skills.filter((item) => item !== skill))}><X size={12} /></button>
                  </span>
                ))}
                <input
                  id="skill-input"
                  form={PROFILE_FORM_ID}
                  value={pendingSkill}
                  disabled={saving}
                  placeholder={draft.skills.length ? "Add another" : "Type a skill, press Enter"}
                  aria-describedby={fieldErrors.skills ? "err-skills" : undefined}
                  onChange={(event) => { setPendingSkill(event.target.value); setSkillNotice(""); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commitSkill(); }
                    else if (event.key === "Backspace" && !pendingSkill && draft.skills.length) setField("skills", draft.skills.slice(0, -1));
                  }}
                  onBlur={() => { commitSkill(); }}
                />
              </div>
              <FieldError id="err-skills" message={fieldErrors.skills} />
            </div>
            <label>LinkedIn
              <input form={PROFILE_FORM_ID} type="url" inputMode="url" value={draft.linkedin} onChange={(event) => setField("linkedin", event.target.value)} maxLength={PROFILE_LIMITS.url} placeholder="https://www.linkedin.com/in/your-name" aria-invalid={Boolean(fieldErrors.linkedin)} aria-describedby={fieldErrors.linkedin ? "err-linkedin" : undefined} disabled={saving} />
            </label>
            <FieldError id="err-linkedin" message={fieldErrors.linkedin} />
            <label>GitHub
              <input form={PROFILE_FORM_ID} type="url" inputMode="url" value={draft.github} onChange={(event) => setField("github", event.target.value)} maxLength={PROFILE_LIMITS.url} placeholder="https://github.com/your-username" aria-invalid={Boolean(fieldErrors.github)} aria-describedby={fieldErrors.github ? "err-github" : undefined} disabled={saving} />
            </label>
            <FieldError id="err-github" message={fieldErrors.github} />
            {(linkedinHref || githubHref) && (
              <div className="profile-links">
                {linkedinHref && <a href={linkedinHref} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> LinkedIn</a>}
                {githubHref && <a href={githubHref} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> GitHub</a>}
              </div>
            )}
          </div>
        </article>
        <article className="panel">
          <h2>Emergency contact</h2>
          <div className="form-stack">
            <label>Contact name<input form={PROFILE_FORM_ID} value={draft.emergencyContactName} onChange={(event) => setField("emergencyContactName", event.target.value)} maxLength={PROFILE_LIMITS.emergencyContactName} placeholder="Who should we call?" aria-invalid={Boolean(fieldErrors.emergencyContactName)} aria-describedby={fieldErrors.emergencyContactName ? "err-ecn" : undefined} disabled={saving} /></label>
            <FieldError id="err-ecn" message={fieldErrors.emergencyContactName} />
            <label>Contact phone<input form={PROFILE_FORM_ID} type="tel" value={draft.emergencyContactPhone} onChange={(event) => setField("emergencyContactPhone", event.target.value)} maxLength={PROFILE_LIMITS.emergencyContactPhone} placeholder="+91 98765 43210" aria-invalid={Boolean(fieldErrors.emergencyContactPhone)} aria-describedby={fieldErrors.emergencyContactPhone ? "err-ecp" : undefined} disabled={saving} /></label>
            <FieldError id="err-ecp" message={fieldErrors.emergencyContactPhone} />
            <p className="helper-text">Digits, +, spaces, and dashes only.</p>
          </div>
        </article>
      </section>
      <form id={PROFILE_FORM_ID} className="panel profile-save-bar" onSubmit={saveProfile} noValidate>
        <button className="primary-button" type="submit" disabled={saving || !dirty || hasErrors}>{saving ? "Saving..." : "Save profile"}</button>
        {saveState.status === "success" && <div role="status" className="success-box">{saveState.message}</div>}
        {saveState.status === "error" && <div role="alert" className="error-box">{saveState.message}</div>}
        {saveState.status === "idle" && dirty && !hasErrors && <span className="helper-text">You have unsaved changes.</span>}
      </form>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Student account</span>
            <h2>Student List</h2>
          </div>
          <Link className="secondary-button" to="/student-records">Open search and status filter</Link>
        </div>
        <p className="helper-text">Use the dedicated Student List page to search your record and filter its approval status.</p>
      </section>
    </div>
  );
}
