import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Reservation flow for the restaurant booking starter.
// Talks to the local POST /api/reservations fixture (same origin, no network access).
// Confirmed bookings are kept in localStorage so they survive a page refresh.

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'reservation:booking';

const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f6f5f3;
    color: #1f2937;
    line-height: 1.5;
  }
  .wrap { width: 100%; max-width: 420px; margin: 0 auto; padding: 24px 16px; }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  h1 { font-size: 1.5rem; margin: 0 0 16px; }
  form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: 0.9rem; }
  input, select {
    width: 100%;
    max-width: 100%;
    padding: 10px 12px;
    font-size: 1rem;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #fff;
    color: inherit;
  }
  input:focus, select:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
  button {
    padding: 12px 16px;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    background: #2563eb;
    color: #fff;
    cursor: pointer;
  }
  button:hover { background: #1d4ed8; }
  button:disabled { background: #93c5fd; cursor: progress; }
  .msg { margin: 12px 0 0; min-height: 1.25rem; font-size: 0.95rem; }
  .msg.error { color: #b91c1c; font-weight: 600; }
  .confirm {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    color: #065f46;
    padding: 16px;
    border-radius: 8px;
    margin: 0 0 16px;
    font-size: 1rem;
  }
  .edit { background: #fff; color: #2563eb; border: 1px solid #2563eb; width: 100%; }
  .edit:hover { background: #eff6ff; }
  @media (min-width: 900px) { .wrap { max-width: 480px; padding: 48px 24px; } }
`;

function loadBooking() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const [booking, setBooking] = useState(loadBooking);
  const [date, setDate] = useState(() => booking?.date || '');
  const [time, setTime] = useState(() => booking?.time || '');
  const [guests, setGuests] = useState(() => (booking ? String(booking.guests) : '1'));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Inject styles once; works across React versions without a CSS build step.
  useEffect(() => {
    if (document.getElementById('reservation-styles')) return;
    const el = document.createElement('style');
    el.id = 'reservation-styles';
    el.textContent = STYLES;
    document.head.appendChild(el);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    // Visible, helpful validation before we contact the fixture.
    if (!date) { setMessage('Please choose a date for your reservation.'); return; }
    if (!time) { setMessage('Please choose a time.'); return; }
    const g = Number(guests);
    if (!Number.isInteger(g) || g < 1 || g > 6) {
      setMessage('Please enter a party size between 1 and 6 guests.');
      return;
    }

    setMessage('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, time, guests: g }),
      });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON body */ }

      if (res.ok) {
        const confirmed = data && data.id ? data : { id: 'fixture-reservation', date, time, guests: g };
        setBooking(confirmed);
        setMessage('');
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmed)); } catch { /* storage unavailable */ }
      } else {
        setMessage((data && data.error) || 'Sorry, we could not complete your reservation. Please try again.');
      }
    } catch {
      setMessage('We could not reach the reservation service. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    setDate(booking.date);
    setTime(booking.time);
    setGuests(String(booking.guests));
    setMessage('');
    setBooking(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  }

  if (booking) {
    return (
      <main className="wrap">
        <div className="card">
          <h1>Reservation confirmed</h1>
          <p className="confirm" data-testid="confirmation" role="status">
            Table for {booking.guests} {Number(booking.guests) === 1 ? 'guest' : 'guests'} on{' '}
            {booking.date} at {booking.time}. Confirmation #{booking.id}.
          </p>
          <button className="edit" data-testid="edit" type="button" onClick={handleEdit}>
            Edit reservation
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="card">
        <h1>Reserve a table</h1>
        <form onSubmit={handleSubmit}>
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
            <select data-testid="time" value={time} onChange={e => setTime(e.target.value)}>
              <option value="">Select time</option>
              {TIMES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Guests
            <input
              data-testid="guests"
              type="number"
              min="1"
              max="6"
              value={guests}
              onChange={e => setGuests(e.target.value)}
            />
          </label>
          <button data-testid="submit" type="submit" disabled={submitting}>
            {submitting ? 'Reserving…' : 'Reserve'}
          </button>
        </form>
        <p
          className={message ? 'msg error' : 'msg'}
          data-testid="message"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
