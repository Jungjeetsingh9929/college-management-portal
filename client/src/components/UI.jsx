import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Info, Search, X, XCircle } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function dismiss(id) {
    setToasts((items) => items.filter((item) => item.id !== id));
  }

  function showToast(message, tone = "info") {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, message, tone }].slice(-4));
    window.setTimeout(() => dismiss(id), 4200);
  }

  useEffect(() => {
    const onToast = (event) => showToast(event.detail?.message || "Something went wrong.", event.detail?.tone || "error");
    window.addEventListener("portal:toast", onToast);
    return () => window.removeEventListener("portal:toast", onToast);
  }, []);

  const value = useMemo(() => ({ showToast, dismiss }), []);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            {toast.tone === "success" ? <CheckCircle2 size={18} /> : toast.tone === "error" ? <XCircle size={18} /> : <Info size={18} />}
            <span>{toast.message}</span>
            <button className="toast-close" type="button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function StatCard({ label, value, hint, tone = "blue", icon: Icon }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-card-top"><span>{label}</span>{Icon && <span className="stat-icon"><Icon size={17} /></span>}</div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function Badge({ value }) {
  const normalized = String(value).toLowerCase();
  return <span className={`badge ${normalized}`}>{value}</span>;
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Info size={20} /></div>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title = "Unable to load this view", text = "Please try again in a moment.", onRetry }) {
  return (
    <div className="empty-state error-state">
      <div className="empty-icon"><XCircle size={20} /></div>
      <strong>{title}</strong>
      <p>{text}</p>
      {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function DashboardSkeleton() {
  return <div className="page-stack skeleton-screen"><div className="stats-grid">{[1, 2, 3, 4].map((item) => <Skeleton className="skeleton-card" key={item} />)}</div><div className="two-column"><Skeleton className="skeleton-panel" /><Skeleton className="skeleton-panel" /></div></div>;
}

export function Modal({ open, title, description, onClose, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
        {children}
      </section>
    </div>
  );
}

export function ProgressBar({ value }) {
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), 100);
  return <div className="progress-track" aria-label={`${safeValue}%`}><span style={{ width: `${safeValue}%` }} /></div>;
}

// A type-to-filter dropdown used anywhere a plain <select> would otherwise
// force people to scroll a long, unsorted list to find one entry (e.g.
// picking a subject/class out of dozens). Falls back gracefully to normal
// keyboard/click interaction and closes on outside click or Escape.
export function SearchableSelect({
  options,
  value,
  onChange,
  getValue = (option) => option.id,
  getLabel = (option) => option.label,
  getSecondaryLabel,
  placeholder = "Search…",
  emptyText = "No matches",
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((option) => String(getValue(option)) === String(value)) || null,
    [options, value, getValue]
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => {
      const haystack = `${getLabel(option)} ${getSecondaryLabel ? getSecondaryLabel(option) : ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, query, getLabel, getSecondaryLabel]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) setHighlighted(0);
  }, [open, query]);

  function commit(option) {
    onChange(getValue(option));
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[highlighted]) commit(filtered[highlighted]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  return (
    <div className={`searchable-select${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={containerRef}>
      <button
        type="button"
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
          setQuery("");
          window.requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <span className={selectedOption ? "" : "placeholder"}>
          {selectedOption ? getLabel(selectedOption) : placeholder}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="searchable-select-panel">
          <div className="searchable-select-search">
            <Search size={14} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder={placeholder}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="searchable-select-options" role="listbox">
            {filtered.length ? filtered.map((option, index) => {
              const optionValue = getValue(option);
              const isSelected = String(optionValue) === String(value);
              return (
                <button
                  type="button"
                  key={optionValue}
                  role="option"
                  aria-selected={isSelected}
                  className={`searchable-select-option${index === highlighted ? " highlighted" : ""}${isSelected ? " selected" : ""}`}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => commit(option)}
                >
                  <span>{getLabel(option)}</span>
                  {getSecondaryLabel && <small>{getSecondaryLabel(option)}</small>}
                  {isSelected && <CheckCircle2 size={14} />}
                </button>
              );
            }) : <div className="searchable-select-empty">{emptyText}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
