import React, { useEffect, useRef, useState } from "react";
import { BookOpen, Download, ExternalLink, FileText, Link2, Pencil, Trash2, Upload } from "lucide-react";
import { Badge, EmptyState, StatCard } from "../components/UI.jsx";
import { apiFetch, downloadToFile } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const blankItem = { title: "", description: "", category: "Textbook", subject: "", type: "file", url: "", audience: "all" };

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function DigitalLibrary() {
  const { user } = useAuth();
  const isStaff = user.role === "admin" || user.role === "teacher";
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [maxFileBytes, setMaxFileBytes] = useState(10 * 1024 * 1024);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [stats, setStats] = useState({ total: 0, files: 0, links: 0 });
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [form, setForm] = useState(blankItem);
  const [file, setFile] = useState(null);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);

  async function loadLibrary() {
    const params = new URLSearchParams();
    if (categoryFilter) params.set("category", categoryFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (search) params.set("q", search);
    if (mineOnly && isStaff) params.set("mine", "true");
    const query = params.toString();
    const data = await apiFetch(`/library${query ? `?${query}` : ""}`);
    setItems(data.items);
    setCategories(data.categories);
    setMaxFileBytes(data.maxFileBytes);
    setAvailableClasses(data.classes || []);
    setStats(data.stats);
  }

  useEffect(() => {
    setLoading(true);
    loadLibrary().catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, typeFilter, search, mineOnly]);

  function startEdit(item) {
    setEditingId(item.id);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setForm({ title: item.title, description: item.description || "", category: item.category, subject: item.subject || "", type: item.type, url: item.url || "", audience: item.audience || "all" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(blankItem);
    setFile(null);
    setEditingId("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function pickFile(event) {
    const chosen = event.target.files?.[0] || null;
    if (chosen && chosen.size > maxFileBytes) {
      setMessage(`That file is too large (limit ${formatSize(maxFileBytes)}).`);
      setMessageType("error");
      event.target.value = "";
      setFile(null);
      return;
    }
    setFile(chosen);
  }

  async function submitItem(formEvent) {
    formEvent.preventDefault();
    setMessage("");
    setMessageType("");
    setSaving(true);
    try {
      if (editingId) {
        // Metadata only: an item's type and uploaded file can't be changed after creation.
        const payload = { title: form.title, description: form.description, category: form.category, subject: form.subject, audience: form.audience };
        if (form.type === "link") payload.url = form.url;
        await apiFetch(`/library/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        setMessage("Library item updated.");
      } else if (form.type === "file") {
        if (!file) throw new Error("Choose a PDF or DOCX file to upload.");
        const body = new FormData();
        body.append("title", form.title);
        body.append("description", form.description);
        body.append("category", form.category);
        body.append("subject", form.subject);
        body.append("type", "file");
        body.append("audience", form.audience);
        body.append("file", file);
        await apiFetch("/library", { method: "POST", body });
        setMessage("Library item added.");
      } else {
        await apiFetch("/library", { method: "POST", body: JSON.stringify(form) });
        setMessage("Library item added.");
      }
      setMessageType("success");
      resetForm();
      await loadLibrary();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id) {
    if (!window.confirm("Delete this library item? This cannot be undone.")) return;
    try {
      await apiFetch(`/library/${id}`, { method: "DELETE" });
      setMessage("Library item deleted.");
      setMessageType("success");
      if (editingId === id) resetForm();
      await loadLibrary();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    }
  }

  function renderItem(item) {
    const canManage = user.role === "admin" || item.createdBy?.id === user.id;
    return (
      <article className="library-card" key={item.id}>
        <div className="library-top">
          <div>
            <strong>{item.title}</strong>
            {item.subject && <span>{item.subject}</span>}
            {item.type === "file" ? (
              <span>
                <FileText size={14} /> {item.file?.name}
                {item.file?.size ? ` · ${formatSize(item.file.size)}` : ""}
              </span>
            ) : (
              <span>
                <Link2 size={14} /> {hostOf(item.url)}
              </span>
            )}
          </div>
          <div className="badge-row">
            <Badge value={item.category} />
            <Badge value={item.type === "file" ? "File" : "Link"} />
            {item.audience && item.audience !== "all" && <Badge value={item.audience} />}
          </div>
        </div>
        {item.description && <p>{item.description}</p>}
        <div className="library-meta-row">
          <small>Added by {item.createdBy?.name || "Staff"}</small>
          <div className="library-actions">
            {item.type === "file" ? (
              <button className="secondary-button small" type="button" onClick={() => downloadToFile(`/library/${item.id}/file`, item.file?.name || "library-file").catch(() => {})}>
                <Download size={14} /> Download
              </button>
            ) : (
              <a className="secondary-button small" href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Open link
              </a>
            )}
            {canManage && (
              <>
                <button className="secondary-button small" type="button" onClick={() => startEdit(item)}>
                  <Pencil size={14} /> Edit
                </button>
                <button className="secondary-button small danger-text" type="button" onClick={() => deleteItem(item.id)}>
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      </article>
    );
  }

  const editingFile = Boolean(editingId) && form.type === "file";

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Library items" value={stats.total} hint="Available to everyone" tone="blue" icon={BookOpen} />
        <StatCard label="Uploaded files" value={stats.files} hint="PDF and DOCX" tone="green" />
        <StatCard label="External links" value={stats.links} hint="Web resources" tone="amber" />
      </section>

      {isStaff && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Digital library</span>
              <h2>{editingId ? "Edit library item" : "Add to the library"}</h2>
            </div>
            <Upload size={22} />
          </div>
          <form className="admin-form" onSubmit={submitItem}>
            <label>
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} />
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {(categories.length ? categories : [form.category]).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject (optional)
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={120} />
            </label>
            <label>
              Audience
              <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                <option value="all">Everyone</option>
                {availableClasses.map((item) => (
                  <option key={item} value={item}>
                    {item} only
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} disabled={Boolean(editingId)}>
                <option value="file">Upload a file (PDF / DOCX)</option>
                <option value="link">External link</option>
              </select>
            </label>
            {form.type === "file" ? (
              !editingFile && (
                <label className="span-two">
                  File (PDF or DOCX, up to {formatSize(maxFileBytes)})
                  <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={pickFile} required />
                </label>
              )
            ) : (
              <label className="span-two">
                Link URL
                <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required maxLength={2000} placeholder="https://" />
              </label>
            )}
            <label className="span-two">
              Description (optional)
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
            </label>
            <button className="primary-button" type="submit" disabled={saving}>
              <Upload size={17} />
              {saving ? "Saving…" : editingId ? "Save changes" : "Add to library"}
            </button>
            {editingId && (
              <button className="secondary-button" type="button" onClick={resetForm}>
                Cancel edit
              </button>
            )}
          </form>
          {editingFile && <p className="library-hint">The uploaded file can't be replaced. To swap the document, delete this item and add a new one.</p>}
          {message && (
            <div role="status" className={messageType === "error" ? "error-box" : "success-box"}>
              {message}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Browse</span>
            <h2>Library</h2>
          </div>
          <BookOpen size={22} />
        </div>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <label>
            Search
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Title, subject, description" maxLength={100} />
          </label>
          <label>
            Category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Files and links</option>
              <option value="file">Files only</option>
              <option value="link">Links only</option>
            </select>
          </label>
          {isStaff && (
            <label className="checkbox-row">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              My items only
            </label>
          )}
          <button className="secondary-button" type="submit">
            Search
          </button>
        </form>

        {loading ? (
          <p>Loading library…</p>
        ) : items.length ? (
          <div className="library-list">{items.map(renderItem)}</div>
        ) : (
          <EmptyState title="Nothing here yet" text={search || categoryFilter || typeFilter ? "No items match these filters." : "Library items will appear here once staff add them."} />
        )}
      </section>
    </div>
  );
}
