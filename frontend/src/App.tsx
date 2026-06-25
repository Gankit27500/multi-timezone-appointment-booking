import { Activity, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Globe2, LockKeyhole, LogIn, LogOut, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, UserCircle, X, Zap } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "";
const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" }
];
const TIMEZONES = ["America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Asia/Dubai", "Australia/Sydney"];

type ExcludedDay = { day: string; message: string };
type Config = {
  smb_id: string;
  timezone: string;
  duration: number;
  start_time: string;
  end_time: string;
  days: number[];
  excluded_days: { days: ExcludedDay[] };
};
type Slot = {
  slot_start: string;
  slot_end: string;
  local_date: string;
  local_start: string;
  local_end: string;
};
type Appointment = {
  id: string;
  smb_id: string;
  lead_id: string;
  status: "ACTIVE" | "CANCELLED";
  slot_start: string;
  slot_end: string;
  lead_name: string;
};
type User = {
  id: string;
  email: string;
  name: string;
  role: string;
};
type LoginResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

const formatter = (timezone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options });

function apiDate(value: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasTimezone ? value : `${value}Z`);
}

function weekStart(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy;
}

function addDaysKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

function weekStartKey(key: string) {
  const weekday = isoWeekdayFromKey(key);
  return addDaysKey(key, -weekday + 1);
}

function isoWeekdayFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return value || 7;
}

function displayDateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateKey(date: Date, timezone: string) {
  const parts = formatter(timezone, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeLabel(value: string, timezone: string) {
  return formatter(timezone, { hour: "2-digit", minute: "2-digit" }).format(apiDate(value));
}

function dateTimeLabel(value: string, timezone: string) {
  return formatter(timezone, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(apiDate(value));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("booking_token");
  const response = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {})
    },
    ...options
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail ?? "Request failed");
  }
  return response.json();
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [week, setWeek] = useState(() => weekStart(new Date()).toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [leadName, setLeadName] = useState("");
  const [holiday, setHoliday] = useState<ExcludedDay>({ day: "", message: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [activePage, setActivePage] = useState<"configuration" | "appointments">("configuration");
  const [loginEmail, setLoginEmail] = useState("admin@lyftr.local");
  const [loginPassword, setLoginPassword] = useState("admin123");
  const [authError, setAuthError] = useState("");

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysKey(week, index)), [week]);
  const slotsByDay = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of slots) groups.set(slot.local_date, [...(groups.get(slot.local_date) ?? []), slot]);
    return groups;
  }, [slots]);

  async function loadConfig() {
    const next = await request<Config>("/api/booking/config");
    setConfig(next);
    setDraft(structuredClone(next));
  }

  async function loadCalendar(active = config) {
    if (!active) return;
    const min = new Date(`${addDaysKey(week, -1)}T00:00:00.000Z`).toISOString();
    const max = new Date(`${addDaysKey(week, 8)}T23:59:59.000Z`).toISOString();
    const [slotData, appointmentData] = await Promise.all([
      request<Slot[]>(`/api/booking/slots?smb_id=${active.smb_id}&min_start_time=${encodeURIComponent(min)}&max_end_time=${encodeURIComponent(max)}`),
      request<Appointment[]>(`/api/booking/appointments?smb_id=${active.smb_id}`)
    ]);
    setSlots(slotData);
    setAppointments(appointmentData);
  }

  useEffect(() => {
    const token = localStorage.getItem("booking_token");
    if (!token) {
      setLoading(false);
      return;
    }
    request<User>("/api/auth/me")
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("booking_token");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadConfig().catch((error) => setMessage(error.message));
  }, [user]);

  useEffect(() => {
    if (!config || !user) return;
    loadCalendar().catch((error) => setMessage(error.message));
  }, [config, week, user]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const saved = await request<Config>("/api/booking/config", {
      method: "PUT",
      body: JSON.stringify(draft)
    });
    setConfig(saved);
    setDraft(structuredClone(saved));
    setMessage("Business configuration saved.");
    setActivePage("appointments");
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    try {
      const response = await request<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      localStorage.setItem("booking_token", response.access_token);
      setUser(response.user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed");
    }
  }

  function logout() {
    localStorage.removeItem("booking_token");
    setUser(null);
    setConfig(null);
    setDraft(null);
    setSlots([]);
    setAppointments([]);
    setActivePage("configuration");
  }

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!selected || !config) return;
    await request<Appointment>("/api/booking/appointments", {
      method: "POST",
      body: JSON.stringify({ smb_id: config.smb_id, lead_name: leadName, slot_start: selected.slot_start })
    });
    setSelected(null);
    setLeadName("");
    setMessage("Appointment booked.");
    await loadCalendar();
  }

  async function cancel(id: string) {
    await request<Appointment>(`/api/booking/appointments/${id}/cancel`, { method: "PATCH" });
    setMessage("Appointment cancelled.");
    await loadCalendar();
  }

  function toggleDay(day: number) {
    if (!draft) return;
    const exists = draft.days.includes(day);
    setDraft({ ...draft, days: exists ? draft.days.filter((item) => item !== day) : [...draft.days, day].sort() });
  }

  function addHoliday() {
    if (!draft || !holiday.day || !holiday.message.trim()) return;
    setDraft({
      ...draft,
      excluded_days: { days: [...draft.excluded_days.days.filter((item) => item.day !== holiday.day), holiday].sort((a, b) => a.day.localeCompare(b.day)) }
    });
    setHoliday({ day: "", message: "" });
  }

  const activeAppointments = appointments.filter((appointment) => appointment.status === "ACTIVE");
  const cancelledAppointments = appointments.filter((appointment) => appointment.status === "CANCELLED");

  if (loading) return <main className="loading">Loading booking system...</main>;

  if (!user) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-brand">
            <LockKeyhole size={28} />
            <div>
              <p>Secure operator access</p>
              <h1>Booking Control Center</h1>
            </div>
          </div>
          <form className="login-form" onSubmit={login}>
            <label>
              Email
              <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
            </label>
            <label>
              Password
              <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
            </label>
            {authError && <div className="auth-error">{authError}</div>}
            <button className="primary" type="submit">
              <LogIn size={18} />
              Sign In
            </button>
          </form>
          <div className="demo-credentials">
            <span>Demo login</span>
            <strong>admin@lyftr.local / admin123</strong>
          </div>
        </section>
        <section className="login-showcase">
          <div>
            <Sparkles size={24} />
            <h2>Timezone-aware booking operations</h2>
            <p>Manage availability, inspect UTC conversion, and prevent duplicate appointments from one protected dashboard.</p>
          </div>
        </section>
      </main>
    );
  }

  if (!draft || !config) return <main className="loading">Loading dashboard...</main>;

  const nextSlot = slots[0];
  const todayKey = dateKey(now, config.timezone);
  const todaySlots = slots.filter((slot) => slot.local_date === todayKey).length;
  const weekCapacity = days.reduce((total, day) => {
    const isWorkingDay = config.days.includes(isoWeekdayFromKey(day));
    const isHoliday = config.excluded_days.days.some((item) => item.day === day);
    return total + (isWorkingDay && !isHoliday ? Math.floor((Number(config.end_time.slice(0, 2)) * 60 + Number(config.end_time.slice(3, 5)) - Number(config.start_time.slice(0, 2)) * 60 - Number(config.start_time.slice(3, 5))) / config.duration) : 0);
  }, 0);

  return (
    <main className="shell">
      <header className="admin-header">
        <div>
          <p>Admin Dashboard</p>
          <h1>{activePage === "configuration" ? "Business Configuration" : "Appointment Booking"}</h1>
        </div>
        <div className="admin-user-card">
          <UserCircle size={34} />
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button className="icon-button" type="button" onClick={logout} title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {activePage === "configuration" ? (
        <section className="setup-page">
          <aside className="config-panel setup-config">
          <div className="panel-title">
            <Globe2 size={20} />
            <h2>Business Configuration</h2>
          </div>
          <form onSubmit={saveConfig} className="config-form">
            <label>
              Timezone
              <select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}>
                {TIMEZONES.map((timezone) => (
                  <option key={timezone}>{timezone}</option>
                ))}
              </select>
            </label>
            <div className="field-row">
              <label>
                Opens
                <input type="time" value={draft.start_time.slice(0, 5)} onChange={(event) => setDraft({ ...draft, start_time: `${event.target.value}:00` })} />
              </label>
              <label>
                Closes
                <input type="time" value={draft.end_time.slice(0, 5)} onChange={(event) => setDraft({ ...draft, end_time: `${event.target.value}:00` })} />
              </label>
            </div>
            <label>
              Slot duration
              <input type="number" min="5" max="240" step="5" value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} />
            </label>
            <div className="weekday-group">
              {WEEKDAYS.map((day) => (
                <button className={draft.days.includes(day.value) ? "selected" : ""} type="button" key={day.value} onClick={() => toggleDay(day.value)}>
                  {day.label}
                </button>
              ))}
            </div>
            <div className="holiday-editor">
              <input type="date" value={holiday.day} onChange={(event) => setHoliday({ ...holiday, day: event.target.value })} />
              <input placeholder="Holiday note" value={holiday.message} onChange={(event) => setHoliday({ ...holiday, message: event.target.value })} />
              <button type="button" className="icon-button" onClick={addHoliday} title="Add holiday">
                <Plus size={18} />
              </button>
            </div>
            <div className="holiday-list">
              {draft.excluded_days.days.map((item) => (
                <span key={item.day}>
                  {item.day} - {item.message}
                  <button type="button" onClick={() => setDraft({ ...draft, excluded_days: { days: draft.excluded_days.days.filter((day) => day.day !== item.day) } })} title="Remove holiday">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
            <button className="primary" type="submit">
              <Check size={18} />
              Save & View Appointment Slots
            </button>
          </form>
          </aside>

          <section className="setup-preview">
            <div>
              <Sparkles size={24} />
              <h2>Set availability first</h2>
              <p>After saving the business timezone, hours, weekdays, and holiday rules, the next page opens with generated slots and booking details.</p>
            </div>
            <div className="setup-steps">
              <span>1. Configure business hours</span>
              <span>2. Save configuration</span>
              <span>3. Review slots and bookings</span>
            </div>
          </section>
        </section>
      ) : (
      <section className="workspace appointments-workspace">
        <section className="calendar-area">
          <header className="calendar-header">
            <div>
              <p>{config.timezone}</p>
              <h2>{formatter(config.timezone, { month: "long", year: "numeric" }).format(displayDateFromKey(week))}</h2>
            </div>
            <div className="toolbar">
              <button className="icon-button" onClick={() => setWeek(addDaysKey(week, -7))} title="Previous week">
                <ChevronLeft size={20} />
              </button>
              <button className="icon-button" onClick={() => setWeek(weekStartKey(dateKey(new Date(), config.timezone)))} title="Current week">
                <Clock size={18} />
              </button>
              <button className="icon-button" onClick={() => setWeek(addDaysKey(week, 7))} title="Next week">
                <ChevronRight size={20} />
              </button>
              <button className="icon-button" onClick={() => loadCalendar()} title="Refresh slots">
                <RefreshCw size={18} />
              </button>
            </div>
          </header>

          {message && <div className="notice">{message}</div>}

          <div className="insight-strip">
            <div className="insight">
              <Clock size={18} />
              <span>Business time</span>
              <strong>{formatter(config.timezone, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(now)}</strong>
            </div>
            <div className="insight">
              <Zap size={18} />
              <span>Next slot</span>
              <strong>{nextSlot ? `${nextSlot.local_date} ${nextSlot.local_start}` : "None"}</strong>
            </div>
            <div className="insight">
              <Activity size={18} />
              <span>Open slots</span>
              <strong>{slots.length} / {weekCapacity}</strong>
            </div>
            <div className="insight">
              <ShieldCheck size={18} />
              <span>Active bookings</span>
              <strong>{activeAppointments.length}</strong>
            </div>
          </div>

          <div className="calendar-grid">
            {days.map((day) => {
              const key = day;
              const isHoliday = config.excluded_days.days.some((item) => item.day === key);
              const isWorkingDay = config.days.includes(isoWeekdayFromKey(key));
              const daySlots = slotsByDay.get(key) ?? [];
              return (
                <article className={`day-column ${isHoliday || !isWorkingDay ? "muted" : ""}`} key={key}>
                  <div className="day-head">
                    <span>{formatter("UTC", { weekday: "short" }).format(displayDateFromKey(key))}</span>
                    <strong>{formatter("UTC", { day: "2-digit" }).format(displayDateFromKey(key))}</strong>
                  </div>
                  {isHoliday && <div className="blocked holiday">Holiday</div>}
                  {!isHoliday && !isWorkingDay && <div className="blocked">Closed weekday</div>}
                  {!isHoliday && isWorkingDay && daySlots.length === 0 && <div className="blocked">No available slots</div>}
                  {daySlots.map((slot) => (
                    <button className="slot" key={slot.slot_start} onClick={() => setSelected(slot)}>
                      {slot.local_start}
                      <span>{slot.local_end}</span>
                    </button>
                  ))}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="appointments-panel">
          <div className="config-summary">
            <div>
              <span>Current configuration</span>
              <strong>{config.timezone}</strong>
              <p>{config.start_time.slice(0, 5)} - {config.end_time.slice(0, 5)} | {config.duration} min slots</p>
            </div>
            <button className="secondary" type="button" onClick={() => setActivePage("configuration")}>
              Edit Configuration
            </button>
          </div>
          <div className="panel-title">
            <CalendarDays size={20} />
            <h2>Bookings</h2>
          </div>
          <div className="appointment-list">
            {activeAppointments.length === 0 && <p className="empty">No active bookings for this business.</p>}
            {activeAppointments.map((appointment) => (
              <div className="appointment" key={appointment.id}>
                <strong>{appointment.lead_name}</strong>
                <span>
                  {formatter(config.timezone, { month: "short", day: "2-digit" }).format(apiDate(appointment.slot_start))} at {timeLabel(appointment.slot_start, config.timezone)}
                </span>
                <button className="icon-button" onClick={() => cancel(appointment.id)} title="Cancel appointment">
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
          <div className="logic-card">
            <div className="logic-title">
              <Sparkles size={18} />
              <strong>Availability engine</strong>
            </div>
            <ul>
              <li>Renders in {config.timezone}, independent of browser timezone.</li>
              <li>Filters weekdays, business hours, holidays, past local slots, and overlaps.</li>
              <li>Stores appointment timestamps in UTC.</li>
              <li>Uses SQLite transaction locking plus an active-slot index for duplicate protection.</li>
            </ul>
          </div>
          <div className="mini-stats">
            <span>
              <strong>{todaySlots}</strong>
              Today
            </span>
            <span>
              <strong>{config.excluded_days.days.length}</strong>
              Holidays
            </span>
            <span>
              <strong>{cancelledAppointments.length}</strong>
              Cancelled
            </span>
          </div>
        </aside>
      </section>
      )}

      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal" onSubmit={book}>
            <button className="close" type="button" onClick={() => setSelected(null)} title="Close booking modal">
              <X size={18} />
            </button>
            <h2>Book Appointment</h2>
            <p>
              {selected.local_date}, {selected.local_start}-{selected.local_end} ({config.timezone})
            </p>
            <div className="utc-preview">
              UTC: {dateTimeLabel(selected.slot_start, "UTC")} to {dateTimeLabel(selected.slot_end, "UTC")}
            </div>
            <label>
              Customer name
              <input autoFocus required value={leadName} onChange={(event) => setLeadName(event.target.value)} />
            </label>
            <button className="primary" type="submit">
              <Check size={18} />
              Confirm Booking
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
