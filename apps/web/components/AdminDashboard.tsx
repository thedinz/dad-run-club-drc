"use client";

import {
  CalendarDays,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  UserRoundPen,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";

type AdminPage = "overview" | "users" | "calendar" | "media" | "settings";

type Summary = {
  counts: {
    users: number;
    activeInviteCodes: number;
    chatMessages: number;
    mediaItems: number;
    calendarEvents: number;
  };
  latestMessages: ChatMessage[];
  settings: AdminSettings;
  instagram: {
    source: string;
    username: string;
    profileUrl: string;
    note?: string;
  };
};

type AdminSettings = {
  adminUsername: string;
  chatRetentionDays: number;
  updatedAt: string;
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

type User = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  passwordSet?: boolean;
  createdAt?: string;
  messageCount?: number;
  mediaCount?: number;
};

type MediaItem = {
  id: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
  user: { firstName: string; lastName: string } | null;
  messageBody: string | null;
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
  recurrenceRule: string | null;
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

type UserForm = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
};

const blankUser: UserForm = {
  firstName: "",
  lastName: "",
  username: "",
  email: "",
  password: ""
};

const navItems: Array<{ id: AdminPage; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: MessageCircle },
  { id: "users", label: "Users", icon: Users },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "settings", label: "Settings", icon: Settings }
];

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

export default function AdminDashboard({
  initialPage = "overview"
}: {
  initialPage?: AdminPage;
}) {
  const [activePage, setActivePage] = useState<AdminPage>(initialPage);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLabel, setInviteLabel] = useState("");
  const [userForm, setUserForm] = useState<UserForm>(blankUser);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<EventForm>(blankEvent);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    adminUsername: "admin",
    currentPassword: "",
    newPassword: "",
    chatRetentionDays: 365
  });
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
        label: "Media",
        value: summary?.counts.mediaItems ?? 0,
        icon: ImageIcon
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
    const local = window.localStorage.getItem("drc-admin-session") ?? "";
    setSavedToken(local);
  }, []);

  useEffect(() => {
    if (savedToken) {
      void loadDashboard(savedToken);
    }
  }, [savedToken]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setStatus("Signing in...");

    try {
      const result = await apiFetch<{
        token: string;
        admin: { username: string };
      }>("/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      window.localStorage.setItem("drc-admin-session", result.token);
      setPassword("");
      setSavedToken(result.token);
      setStatus(`Signed in as ${result.admin.username}`);
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
  }

  function logout() {
    window.localStorage.removeItem("drc-admin-session");
    setSavedToken("");
    setSummary(null);
  }

  async function loadDashboard(adminToken = savedToken) {
    if (!adminToken) {
      return;
    }

    setStatus("Refreshing...");
    const now = new Date();
    const to = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 120);

    try {
      const [summaryData, inviteData, userData, mediaData, eventData] =
        await Promise.all([
          adminFetch<Summary>("/admin/summary", adminToken),
          adminFetch<{ inviteCodes: InviteCode[] }>(
            "/admin/invite-codes",
            adminToken
          ),
          adminFetch<{ users: User[] }>("/admin/users", adminToken),
          adminFetch<{ media: MediaItem[] }>("/admin/media", adminToken),
          apiFetch<{ events: CalendarEvent[] }>(
            `/events?from=${encodeURIComponent(
              now.toISOString()
            )}&to=${encodeURIComponent(to.toISOString())}`
          )
        ]);

      setSummary(summaryData);
      setSettingsForm((current) => ({
        ...current,
        adminUsername: summaryData.settings.adminUsername,
        chatRetentionDays: summaryData.settings.chatRetentionDays
      }));
      setInviteCodes(inviteData.inviteCodes);
      setUsers(userData.users);
      setMedia(mediaData.media);
      setEvents(eventData.events);
      setStatus("Dashboard is current");
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
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

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    const payload = {
      firstName: userForm.firstName,
      lastName: userForm.lastName,
      username: userForm.username,
      email: userForm.email,
      ...(userForm.password ? { password: userForm.password } : {})
    };

    await adminFetch(
      editingUserId ? `/admin/users/${editingUserId}` : "/admin/users",
      savedToken,
      {
        method: editingUserId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      }
    );
    setEditingUserId(null);
    setUserForm(blankUser);
    await loadDashboard();
  }

  function editUser(user: User) {
    setEditingUserId(user.id);
    setUserForm({
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
      password: ""
    });
  }

  async function deleteUser(id: string) {
    await adminFetch(`/admin/users/${id}`, savedToken, { method: "DELETE" });
    await loadDashboard();
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    const payload = {
      ...eventForm,
      startAt: new Date(eventForm.startAt).toISOString(),
      endAt: new Date(eventForm.endAt).toISOString()
    };

    await adminFetch(
      editingEventId ? `/events/${editingEventId}` : "/events",
      savedToken,
      {
        method: editingEventId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      }
    );

    setEditingEventId(null);
    setEventForm(blankEvent());
    await loadDashboard();
  }

  async function deleteEvent(item: CalendarEvent, scope: "single" | "series") {
    const params = new URLSearchParams({ scope });
    if (scope === "single") {
      params.set("occurrenceStartAt", item.startAt);
    }

    await adminFetch(`/events/${item.eventId}?${params.toString()}`, savedToken, {
      method: "DELETE"
    });
    await loadDashboard();
  }

  function editEvent(item: CalendarEvent) {
    setEditingEventId(item.eventId);
    setEventForm({
      title: item.title,
      description: item.description ?? "",
      location: item.location ?? "",
      startAt: toLocalInput(new Date(item.startAt)),
      endAt: toLocalInput(new Date(item.endAt)),
      recurrenceFrequency: recurrenceFromRule(item.recurrenceRule),
      color: item.color
    });
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await adminFetch("/admin/settings", savedToken, {
      method: "PUT",
      body: JSON.stringify({
        adminUsername: settingsForm.adminUsername,
        currentPassword: settingsForm.currentPassword || undefined,
        newPassword: settingsForm.newPassword || undefined,
        chatRetentionDays: Number(settingsForm.chatRetentionDays)
      })
    });
    setSettingsForm((current) => ({
      ...current,
      currentPassword: "",
      newPassword: ""
    }));
    await loadDashboard();
  }

  async function runPrune() {
    const result = await adminFetch<{
      deletedMessages: number;
      deletedMediaFiles: number;
    }>("/admin/maintenance/prune-chat", savedToken, { method: "POST" });
    setStatus(
      `Pruned ${result.deletedMessages} messages and ${result.deletedMediaFiles} media files`
    );
    await loadDashboard();
  }

  async function deleteMedia(id: string) {
    await adminFetch(`/admin/media/${id}`, savedToken, { method: "DELETE" });
    await loadDashboard();
  }

  if (!savedToken) {
    return (
      <main className="admin-shell login-page">
        <form className="login-panel" onSubmit={login}>
          <img src="/logo.png" alt="" />
          <div>
            <p className="eyebrow">Dad Run Club</p>
            <h1>Admin Login</h1>
          </div>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
          />
          <button type="submit">
            <KeyRound size={16} />
            Sign in
          </button>
          <p className="body-copy">Default first-run credentials are admin/admin.</p>
        </form>
      </main>
    );
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
        <div className="header-actions">
          <button className="icon-button" title="Refresh dashboard" onClick={() => loadDashboard()}>
            <RefreshCw size={18} />
          </button>
          <button className="icon-button" title="Sign out" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <nav className="admin-nav" aria-label="Admin sections">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activePage === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActivePage(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <p className="status-line">{status}</p>

      {activePage === "overview" ? (
        <>
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
            <InstagramPanel summary={summary} />
            <InvitePanel
              inviteCode={inviteCode}
              inviteCodes={inviteCodes}
              inviteLabel={inviteLabel}
              onArchive={archiveInvite}
              onCreate={createInvite}
              setInviteCode={setInviteCode}
              setInviteLabel={setInviteLabel}
            />
          </section>

          <LatestChatPanel messages={summary?.latestMessages ?? []} />
        </>
      ) : null}

      {activePage === "users" ? (
        <UsersPanel
          editingUserId={editingUserId}
          form={userForm}
          onCancel={() => {
            setEditingUserId(null);
            setUserForm(blankUser);
          }}
          onDelete={deleteUser}
          onEdit={editUser}
          onSave={saveUser}
          setForm={setUserForm}
          users={users}
        />
      ) : null}

      {activePage === "calendar" ? (
        <CalendarPanel
          editingEventId={editingEventId}
          events={events}
          form={eventForm}
          onCancel={() => {
            setEditingEventId(null);
            setEventForm(blankEvent());
          }}
          onDelete={deleteEvent}
          onEdit={editEvent}
          onSave={saveEvent}
          setForm={setEventForm}
        />
      ) : null}

      {activePage === "media" ? (
        <MediaPanel media={media} token={savedToken} onDelete={deleteMedia} />
      ) : null}

      {activePage === "settings" ? (
        <SettingsPanel
          form={settingsForm}
          onPrune={runPrune}
          onSave={saveSettings}
          setForm={setSettingsForm}
        />
      ) : null}
    </main>
  );
}

function InstagramPanel({ summary }: { summary: Summary | null }) {
  return (
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
      {summary?.instagram.note ? <p className="notice">{summary.instagram.note}</p> : null}
    </div>
  );
}

function InvitePanel({
  inviteCode,
  inviteCodes,
  inviteLabel,
  onArchive,
  onCreate,
  setInviteCode,
  setInviteLabel
}: {
  inviteCode: string;
  inviteCodes: InviteCode[];
  inviteLabel: string;
  onArchive: (id: string) => void;
  onCreate: (event: FormEvent) => void;
  setInviteCode: (value: string) => void;
  setInviteLabel: (value: string) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-heading">
        <h2>Invite Codes</h2>
      </div>
      <form className="stack-form" onSubmit={onCreate}>
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
              onClick={() => onArchive(code.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersPanel({
  editingUserId,
  form,
  onCancel,
  onDelete,
  onEdit,
  onSave,
  setForm,
  users
}: {
  editingUserId: string | null;
  form: UserForm;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (user: User) => void;
  onSave: (event: FormEvent) => void;
  setForm: (form: UserForm) => void;
  users: User[];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{editingUserId ? "Edit User" : "Create User"}</h2>
      </div>
      <form className="event-form" onSubmit={onSave}>
        <input
          value={form.firstName}
          onChange={(event) => setForm({ ...form, firstName: event.target.value })}
          placeholder="First name"
          required
        />
        <input
          value={form.lastName}
          onChange={(event) => setForm({ ...form, lastName: event.target.value })}
          placeholder="Last name"
          required
        />
        <input
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          placeholder="Email"
          required
          type="email"
        />
        <input
          autoCapitalize="none"
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          placeholder="Username"
          required
        />
        <input
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          placeholder={editingUserId ? "New password (optional)" : "Password"}
          required={!editingUserId}
          type="password"
        />
        <button type="submit">
          <Save size={16} />
          {editingUserId ? "Update" : "Create"}
        </button>
        {editingUserId ? (
          <button className="secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </form>

      <div className="list">
        {users.map((user) => (
          <div className="list-row" key={user.id}>
            <div>
              <strong>
                {user.firstName} {user.lastName}
              </strong>
              <span>
                @{user.username} - {user.email} - {user.messageCount ?? 0} messages
                - {user.mediaCount ?? 0} media
              </span>
            </div>
            <div className="row-actions">
              <button className="secondary" onClick={() => onEdit(user)}>
                <UserRoundPen size={16} />
                Edit
              </button>
              <button
                className="icon-button danger"
                title="Delete user"
                onClick={() => onDelete(user.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CalendarPanel({
  editingEventId,
  events,
  form,
  onCancel,
  onDelete,
  onEdit,
  onSave,
  setForm
}: {
  editingEventId: string | null;
  events: CalendarEvent[];
  form: EventForm;
  onCancel: () => void;
  onDelete: (event: CalendarEvent, scope: "single" | "series") => void;
  onEdit: (event: CalendarEvent) => void;
  onSave: (event: FormEvent) => void;
  setForm: (form: EventForm) => void;
}) {
  return (
    <>
      <section className="panel event-editor">
        <div className="panel-heading">
          <h2>{editingEventId ? "Edit Event Series" : "Add Event"}</h2>
        </div>
        <form className="event-form" onSubmit={onSave}>
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
            {editingEventId ? "Update" : "Add"}
          </button>
          {editingEventId ? (
            <button className="secondary" type="button" onClick={onCancel}>
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
                <button className="secondary" onClick={() => onEdit(item)}>
                  Edit
                </button>
                {item.recurring ? (
                  <button className="secondary" onClick={() => onDelete(item, "single")}>
                    Delete occurrence
                  </button>
                ) : null}
                <button
                  className="icon-button danger"
                  title="Delete series"
                  onClick={() => onDelete(item, "series")}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function MediaPanel({
  media,
  onDelete,
  token
}: {
  media: MediaItem[];
  onDelete: (id: string) => void;
  token: string;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Media Items</h2>
      </div>
      <div className="media-grid">
        {media.map((item) => {
          const url = `${API_URL}${item.url}?token=${encodeURIComponent(token)}`;
          return (
            <article className="media-card" key={item.id}>
              {item.mimeType.startsWith("image/") ? (
                <img src={url} alt={item.originalName ?? "Uploaded media"} />
              ) : (
                <a className="media-download" href={url} target="_blank" rel="noreferrer">
                  <ImageIcon size={28} />
                  Open file
                </a>
              )}
              <div>
                <strong>{item.originalName ?? item.mimeType}</strong>
                <span>
                  {formatBytes(item.sizeBytes)} - {formatDate(item.createdAt)}
                </span>
                <span>
                  {item.user
                    ? `${item.user.firstName} ${item.user.lastName}`
                    : "Unknown user"}
                </span>
                {item.messageBody ? <p>{item.messageBody}</p> : null}
              </div>
              <button className="danger" onClick={() => onDelete(item.id)}>
                <Trash2 size={16} />
                Delete
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SettingsPanel({
  form,
  onPrune,
  onSave,
  setForm
}: {
  form: {
    adminUsername: string;
    currentPassword: string;
    newPassword: string;
    chatRetentionDays: number;
  };
  onPrune: () => void;
  onSave: (event: FormEvent) => void;
  setForm: (form: {
    adminUsername: string;
    currentPassword: string;
    newPassword: string;
    chatRetentionDays: number;
  }) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Settings</h2>
      </div>
      <form className="settings-form" onSubmit={onSave}>
        <label>
          <span>Admin username</span>
          <input
            value={form.adminUsername}
            onChange={(event) => setForm({ ...form, adminUsername: event.target.value })}
          />
        </label>
        <label>
          <span>Current password</span>
          <input
            value={form.currentPassword}
            onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
            type="password"
          />
        </label>
        <label>
          <span>New password</span>
          <input
            value={form.newPassword}
            onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
            type="password"
          />
        </label>
        <label>
          <span>Chat retention days</span>
          <input
            max={1095}
            min={30}
            value={form.chatRetentionDays}
            onChange={(event) =>
              setForm({ ...form, chatRetentionDays: Number(event.target.value) })
            }
            type="number"
          />
        </label>
        <button type="submit">
          <Save size={16} />
          Save Settings
        </button>
        <button className="secondary" type="button" onClick={onPrune}>
          Run cleanup now
        </button>
      </form>
    </section>
  );
}

function LatestChatPanel({ messages }: { messages: ChatMessage[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Latest Chat</h2>
      </div>
      <div className="list">
        {messages.map((message) => (
          <div className="list-row" key={message.id}>
            <div>
              <strong>
                {message.user.firstName} {message.user.lastName}
              </strong>
              <span>{message.body || "Media message"}</span>
            </div>
            <time>{formatDate(message.createdAt)}</time>
          </div>
        ))}
      </div>
    </section>
  );
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<T>;
}

async function readApiError(response: Response) {
  const fallback = `Request failed with ${response.status}`;
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as {
      error?: string;
      detail?: string;
      message?: string;
    };
    return [parsed.error ?? parsed.message, parsed.detail]
      .filter(Boolean)
      .join(": ") || fallback;
  } catch {
    return text;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong";
}

async function adminFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return apiFetch<T>(path, {
    ...init,
    headers
  });
}

function toLocalInput(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function recurrenceFromRule(rule: string | null): EventForm["recurrenceFrequency"] {
  if (!rule) {
    return "NONE";
  }

  if (rule.includes("FREQ=DAILY")) {
    return "DAILY";
  }

  if (rule.includes("FREQ=MONTHLY")) {
    return "MONTHLY";
  }

  return "WEEKLY";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
