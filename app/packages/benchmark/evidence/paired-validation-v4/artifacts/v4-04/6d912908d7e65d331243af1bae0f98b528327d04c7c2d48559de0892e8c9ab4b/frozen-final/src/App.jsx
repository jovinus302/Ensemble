import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

// Completed reservation flow: validated booking form that talks to the local
// POST /api/reservations fixture, shows helpful errors, renders a confirmation
// view, and persists the saved booking across refreshes via localStorage.

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'reservation:booking:v1';

function loadBooking() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.date && parsed.time && parsed.guests != null) return parsed;
  } catch {
    /* ignore unreadable or blocked storage */
  }
  return null;
}

const styles = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f5f7; color: #16202c;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; }
  main { width: 100%; max-width: 480px; margin: 0 auto; padding: 24px 16px 56px; }
  h1 { font-size: 1.5rem; line-height: 1.2; margin: 0 0 20px; }
  form, .card { display: flex; flex-direction: column; gap: 16px; background: #fff;
    padding: 20px; border-radius: 14px; box-shadow: 0 1px 4px rgba(16,32,44,0.12); }
  label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: 0.95rem; }
  input, select { width: 100%; padding: 11px 12px; font-size: 1rem; color: inherit;
    border: 1px solid #b9c0cb; border-radius: 9px; background: #fff; }
  input:focus-visible, select:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
  button { padding: 12px 16px; font-size: 1rem; font-weight: 600; border: none; border-radius: 9px; cursor: pointer; }
  button[type="submit"] { color: #fff; background: #2563eb; }
  button[type="submit"]:hover { background: #1d4ed8; }
  button[type="submit"]:disabled { background: #9db4e8; cursor: progress; }
  .message { margin: 0; min-height: 1.25rem; font-weight: 600; color: #b91c1c; }
  .message:empty { min-height: 0; }
  .confirm-lead { margin: 0; color: #15803d; font-weight: 600; }
  dl { margin: 4px 0 8px; display: grid; gap: 10px; }
  dl > div { display: flex; justify-content: space-between; gap: 16px;
    padding-bottom: 8px; border-bottom: 1px solid #eef0f3; }
  dl > div:last-child { border-bottom: none; padding-bottom: 0; }
  dt { font-weight: 600; color: #5a6676; }
  dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .edit-btn { color: #16202c; background: #e6e9ee; }
  .edit-btn:hover { background: #d7dbe2; }
  @media (min-width: 900px) { main { max-width: 560px; padding-top: 48px; } h1 { font-size: 1.75rem; } }
`;

function App() {
  const [booking, setBooking] = useState(loadBooking);
  const [date, setDate] = useState(() => booking?.date ?? '');
  const [time, setTime] = useState(() => booking?.time ?? '');
  const [guests, setGuests] = useState(() => (booking ? String(booking.guests) : '2'));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');

    if (!date) { setMessage('Please choose a date for your reservation.'); return; }
    if (!time) { setMessage('Please choose a time for your reservation.'); return; }
    const partySize = Number(guests);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 6) {
      setMessage('Please enter a party size between 1 and 6 guests.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, time, guests: partySize }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const confirmed = {
          id: data.id,
          date: data.date ?? date,
          time: data.time ?? time,
          guests: data.guests ?? partySize,
        };
        setBooking(confirmed);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmed)); } catch { /* storage may be unavailable */ }
      } else {
        setMessage(data.error || 'We could not complete your reservation. Please try again.');
      }
    } catch {
      setMessage('Could not reach the reservation service. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    setMessage('');
    setBooking(null);
  }

  if (booking) {
    return (
      <main>
        <style>{styles}</style>
        <h1>Reservation confirmed</h1>
        <section className="card" data-testid="confirmation" aria-live="polite">
          <p className="confirm-lead">Your table is booked — we look forward to seeing you.</p>
          <dl>
            <div><dt>Date</dt><dd>{booking.date}</dd></div>
            <div><dt>Time</dt><dd>{booking.time}</dd></div>
            <div><dt>Guests</dt><dd>{booking.guests}</dd></div>
          </dl>
          <button type="button" className="edit-btn" data-testid="edit" onClick={handleEdit}>
            Edit reservation
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <style>{styles}</style>
      <h1>Reserve a table</h1>
      <form onSubmit={handleSubmit} noValidate>
        <label>
          Date
          <input
            data-testid="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </label>
        <label>
          Time
          <select
            data-testid="time"
            value={time}
            onChange={e => setTime(e.target.value)}
          >
            <option value="">Select time</option>
            {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Guests
          <input
            data-testid="guests"
            type="number"
            min="1"
            max="6"
            step="1"
            value={guests}
            onChange={e => setGuests(e.target.value)}
          />
        </label>
        <button data-testid="submit" type="submit" disabled={submitting}>
          {submitting ? 'Reserving…' : 'Reserve'}
        </button>
        <p data-testid="message" className="message" role="alert" aria-live="assertive">{message}</p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
