import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarPlus, MapPin, Pencil, Trash2 } from "lucide-react";
import { Badge, EmptyState, StatCard } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const blankEvent = {
  title: "",
  description: "",
  category: "Academic",
  startDate: "",
  endDate: "",
  startTime: "",
  location: "",
  audience: "all"
};

function formatDateRange(event) {
  const start = new Date(`${event.startDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (!event.endDate || event.endDate === event.startDate) return start;
  const end = new Date(`${event.endDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${start} – ${end}`;
}

export function EventsCalendar() {
  const { user } = useAuth();
  const isStaff = user.role === "admin" || user.role === "teacher";
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [stats, setStats] = useState({ total: 0, upcoming: 0, thisWeek: 0 });
  const [categoryFilter, setCategoryFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [form, setForm] = useState(blankEvent);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadEvents() {
    const params = new URLSearchParams();
    if (categoryFilter) params.set("category", categoryFilter);
    if (mineOnly && isStaff) params.set("mine", "true");
    const query = params.toString();
    const data = await apiFetch(`/events${query ? `?${query}` : ""}`);
    setEvents(data.events);
    setCategories(data.categories);
    setAvailableClasses(data.availableClasses || []);
    setStats(data.stats);
  }

  useEffect(() => {
    setLoading(true);
    loadEvents().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, mineOnly]);

  const grouped = useMemo(() => {
    return {
      upcoming: events.filter((event) => event.status !== "past"),
      past: events.filter((event) => event.status === "past")
    };
  }, [events]);

  function startEdit(event) {
    setEditingId(event.id);
    setForm({
      title: event.title,
      description: event.description || "",
      category: event.category,
      startDate: event.startDate,
      endDate: event.endDate === event.startDate ? "" : event.endDate,
      startTime: event.startTime || "",
      location: event.location || "",
      audience: event.audience
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(blankEvent);
    setEditingId("");
  }

  async function submitEvent(formEvent) {
    formEvent.preventDefault();
    setMessage("");
    setMessageType("");
    try {
      const payload = { ...form, endDate: form.endDate || undefined, startTime: form.startTime || undefined, audience: form.audience || "all" };
      if (editingId) {
        await apiFetch(`/events/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        setMessage("Event updated.");
      } else {
        await apiFetch("/events", { method: "POST", body: JSON.stringify(payload) });
        setMessage("Event published.");
      }
      setMessageType("success");
      resetForm();
      await loadEvents();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    }
  }

  async function deleteEvent(id) {
    if (!window.confirm("Delete this event? This cannot be undone.")) return;
    try {
      await apiFetch(`/events/${id}`, { method: "DELETE" });
      setMessage("Event deleted.");
      setMessageType("success");
      if (editingId === id) resetForm();
      await loadEvents();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    }
  }

  function renderEvent(event) {
    const canManage = user.role === "admin" || event.createdBy?.id === user.id;
    return (
      <article className="event-card" key={event.id}>
        <div className="event-top">
          <div>
            <strong>{event.title}</strong>
            <span>
              <CalendarClock size={14} /> {formatDateRange(event)}
              {event.startTime ? ` · ${event.startTime}` : ""}
            </span>
            {event.location && (
              <span>
                <MapPin size={14} /> {event.location}
              </span>
            )}
            {event.audience !== "all" && <span>Audience: {event.audience}</span>}
          </div>
          <div className="badge-row">
            <Badge value={event.category} />
            <Badge value={event.status} />
          </div>
        </div>
        {event.description && <p>{event.description}</p>}
        {isStaff && (
          <div className="event-meta-row">
            <small>Posted by {event.createdBy?.name || "Staff"}</small>
            {canManage && (
              <div className="event-actions">
                <button className="secondary-button small" type="button" onClick={() => startEdit(event)}>
                  <Pencil size={14} /> Edit
                </button>
                <button className="secondary-button small danger-text" type="button" onClick={() => deleteEvent(event.id)}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Total events" value={stats.total} hint="Visible to you" tone="blue" icon={CalendarClock} />
        <StatCard label="Upcoming" value={stats.upcoming} hint="From today" tone="green" />
        <StatCard label="This week" value={stats.thisWeek} hint="Next 7 days" tone="amber" />
      </section>

      {isStaff && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Events calendar</span>
              <h2>{editingId ? "Edit event" : "Publish an event"}</h2>
            </div>
            <CalendarPlus size={22} />
          </div>
          <form className="admin-form" onSubmit={submitEvent}>
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
              Start date
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </label>
            <label>
              End date (optional)
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} min={form.startDate || undefined} />
            </label>
            <label>
              Start time (optional)
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </label>
            <label>
              Location
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={160} />
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
            <label className="span-two">
              Description (optional)
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={3000} />
            </label>
            <button className="primary-button" type="submit">
              <CalendarPlus size={17} />
              {editingId ? "Save changes" : "Publish event"}
            </button>
            {editingId && (
              <button className="secondary-button" type="button" onClick={resetForm}>
                Cancel edit
              </button>
            )}
          </form>
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
            <span className="eyebrow">Campus calendar</span>
            <h2>Events</h2>
          </div>
          <CalendarClock size={22} />
        </div>
        <div className="toolbar">
          <label>
            Category filter
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {(categories.length ? categories : []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          {isStaff && (
            <label className="checkbox-row">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              My events only
            </label>
          )}
        </div>

        {loading ? (
          <p>Loading events…</p>
        ) : grouped.upcoming.length || grouped.past.length ? (
          <div className="event-list">
            {grouped.upcoming.length ? (
              grouped.upcoming.map(renderEvent)
            ) : (
              <EmptyState title="No upcoming events" text="Check back soon, or browse past events below." />
            )}
            {grouped.past.length > 0 && (
              <details className="past-events-toggle">
                <summary>Show {grouped.past.length} past event{grouped.past.length === 1 ? "" : "s"}</summary>
                <div className="event-list">{grouped.past.map(renderEvent)}</div>
              </details>
            )}
          </div>
        ) : (
          <EmptyState title="No events yet" text="Published events will appear here." />
        )}
      </section>
    </div>
  );
}
