"use client";

import {
  CalendarDays,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";

type Summary = {
  counts: {
    users: number;
    activeInviteCodes: number;
    chatMessages: number;
    calendarEvents: number;
  };
  latestMessages: ChatMessage[];
  instagram: {
    source: string;
    username: string;
    profileUrl: string;
    note?: string;
  };
};

type InviteCode = {
  id: string;
  code: string;
  label: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  expiresAt: string | null;
};

type CalendarEvent = {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  recurring: boolean;
  color: string;
};

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  user: {
    firstName: string;
    lastName: string;
  };
};

type EventForm = {
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  recurrenceFrequency: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  color: string;
};

const blankEvent = (): EventForm => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: "",
    description: "",
    location: "",
    startAt: toLocalInput(start),
    endAt: toLocalInput(end),
    recurrenceFrequency: "NONE",
    color: "#1f8a70"
  };
};

export default function AdminDashboard() {
  const [token, setToken] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLabel, setInviteLabel] = useState("");
  const [form, setForm] = useState<EventForm>(blankEvent);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");

  const metrics = useMemo(
    () => [
      {
        label: "Members",
        value: summary?.counts.users ?? 0,
        icon: Users
      },
      {
        label: "Invite Codes",
        value: summary?.counts.activeInviteCodes ?? 0,
        icon: KeyRound
      },
      {
        label: "Messages",
        value: summary?.counts.chatMessages ?? 0,
        icon: MessageCircle
      },
      {
        label: "Event Series",
        value: summary?.counts.calendarEvents ?? 0,
        icon: CalendarDays
      }
    ],
    [summary]
  );

  useEffect(() => {
    const local = window.localStorage.getItem("drc-admin-token") ?? "";
    setToken(local);
    setSavedToken(local);
  }, []);

  useEffect(() => {
    if (savedToken) {
      void loadDashboard(savedToken);
    }
  }, [savedToken]);

  async function loadDashboard(adminToken = savedToken) {
    if (!adminToken) {
      return;
    }

    setStatus("Refreshing dashboard...");
    const now = new Date();
    const to = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90);
    const [summaryData, inviteData, eventData] = await Promise.all([
      adminFetch<Summary>("/admin/summary", adminToken),
      adminFetch<{ inviteCodes: InviteCode[] }>("/admin/invite-codes", adminToken),
      fetch(
        `${API_URL}/events?from=${encodeURIComponent(
          now.toISOString()
        )}&to=${encodeURIComponent(to.toISOString())}`
      ).then((response) => response.json() as Promise<{ events: CalendarEvent[] }>)
    ]);

    setSummary(summaryData);
    setInviteCodes(inviteData.inviteCodes);
    setEvents(eventData.events);
    setStatus("Dashboard is current");
  }

  function saveToken(event: FormEvent) {
    event.preventDefault();
    window.localStorage.setItem("drc-admin-token", token);
    setSavedToken(token);
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    await adminFetch("/admin/invite-codes", savedToken, {
      method: "POST",
      body: JSON.stringify({
        code: inviteCode,
        label: inviteLabel || null
      })
    });
    setInviteCode("");
    setInviteLabel("");
    await loadDashboard();
  }

  async function archiveInvite(id: string) {
    await adminFetch(`/admin/invite-codes/${id}`, savedToken, {
      method: "DELETE"
    });
    await loadDashboard();
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    const payload = {
      ...form,
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString()
    };

    await adminFetch(editingId ? `/events/${editingId}` : "/events", savedToken, {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });

    setEditingId(null);
    setForm(blankEvent());
    await loadDashboard();
  }

  async function deleteEvent(item: CalendarEvent, scope: "single" | "series") {
    const url = new URL(`${API_URL}/events/${item.eventId}`);
    url.searchParams.set("scope", scope);
    if (scope === "single") {
      url.searchParams.set("occurrenceStartAt", item.startAt);
    }

    await fetch(url, {
      method: "DELETE",
      headers: { "x-admin-token": savedToken }
    });
    await loadDashboard();
  }

  function editEvent(item: CalendarEvent) {
    setEditingId(item.eventId);
    setForm({
      title: item.title,
      description: item.description ?? "",
      location: item.location ?? "",
      startAt: toLocalInput(new Date(item.startAt)),
      endAt: toLocalInput(new Date(item.endAt)),
      recurrenceFrequency: item.recurring ? "WEEKLY" : "NONE",
      color: item.color
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div className="brand-mark">
          <img src="/logo.png" alt="" />
          <div>
            <p>Dad Run Club</p>
            <h1>Admin</h1>
          </div>
        </div>
        <button className="icon-button" title="Refresh dashboard" onClick={() => loadDashboard()}>
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="admin-login" aria-label="Admin token">
        <form onSubmit={saveToken}>
          <KeyRound size={18} />
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Admin token"
            type="password"
          />
          <button type="submit">
            <Save size={16} />
            Save
          </button>
        </form>
        <span>{status}</span>
      </section>

      <section className="metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div className="metric" key={metric.label}>
              <Icon size={20} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          );
        })}
      </section>

      <section className="admin-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Instagram</h2>
            {summary?.instagram.profileUrl ? (
              <a href={summary.instagram.profileUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
              </a>
            ) : null}
          </div>
          <p className="eyebrow">@{summary?.instagram.username ?? "dadrunclubplymouth"}</p>
          <p className="body-copy">
            Feed source: <strong>{summary?.instagram.source ?? "unknown"}</strong>
          </p>
          {summary?.instagram.note ? (
            <p className="notice">{summary.instagram.note}</p>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Invite Codes</h2>
          </div>
          <form className="stack-form" onSubmit={createInvite}>
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              placeholder="NEW-CODE"
            />
            <input
              value={inviteLabel}
              onChange={(event) => setInviteLabel(event.target.value)}
              placeholder="Label"
            />
            <button type="submit">
              <Plus size={16} />
              Create
            </button>
          </form>
          <div className="list">
            {inviteCodes.map((code) => (
              <div className="list-row" key={code.id}>
                <div>
                  <strong>{code.code}</strong>
                  <span>
                    {code.label ?? "No label"} - {code.uses}
                    {code.maxUses ? `/${code.maxUses}` : ""} used
                  </span>
                </div>
                <button
                  className="icon-button danger"
                  title="Archive invite code"
                  onClick={() => archiveInvite(code.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel event-editor">
        <div className="panel-heading">
          <h2>{editingId ? "Edit Event Series" : "Add Event"}</h2>
        </div>
        <form className="event-form" onSubmit={saveEvent}>
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Event title"
            required
          />
          <input
            value={form.location}
            onChange={(event) => setForm({ ...form, location: event.target.value })}
            placeholder="Location"
          />
          <input
            value={form.startAt}
            onChange={(event) => setForm({ ...form, startAt: event.target.value })}
            type="datetime-local"
            required
          />
          <input
            value={form.endAt}
            onChange={(event) => setForm({ ...form, endAt: event.target.value })}
            type="datetime-local"
            required
          />
          <select
            value={form.recurrenceFrequency}
            onChange={(event) =>
              setForm({
                ...form,
                recurrenceFrequency: event.target.value as EventForm["recurrenceFrequency"]
              })
            }
          >
            <option value="NONE">One time</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Notes"
          />
          <button type="submit">
            <Save size={16} />
            {editingId ? "Update" : "Add"}
          </button>
          {editingId ? (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(blankEvent());
              }}
            >
              Cancel
            </button>
          ) : null}
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Upcoming Events</h2>
        </div>
        <div className="list events-list">
          {events.map((item) => (
            <div className="list-row event-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {formatDate(item.startAt)} at {item.location || "TBD"}
                  {item.recurring ? " - recurring" : ""}
                </span>
              </div>
              <div className="row-actions">
                <button className="secondary" onClick={() => editEvent(item)}>
                  Edit
                </button>
                {item.recurring ? (
                  <button
                    className="secondary"
                    onClick={() => deleteEvent(item, "single")}
                  >
                    Delete occurrence
                  </button>
                ) : null}
                <button
                  className="icon-button danger"
                  title="Delete series"
                  onClick={() => deleteEvent(item, "series")}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Latest Chat</h2>
        </div>
        <div className="list">
          {(summary?.latestMessages ?? []).map((message) => (
            <div className="list-row" key={message.id}>
              <div>
                <strong>
                  {message.user.firstName} {message.user.lastName}
                </strong>
                <span>{message.body}</span>
              </div>
              <time>{formatDate(message.createdAt)}</time>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

async function adminFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

function toLocalInput(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
