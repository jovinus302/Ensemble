import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// Reservation flow completed on top of the shared starter.
// Only this file changed — build.mjs, server.mjs, index.html and the fixtures are left untouched.

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'reservation:booking';

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1f2430;
    background: #f4f6fb;
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
  }
  .booking {
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    padding: 24px 20px 48px;
    min-height: 100vh;
  }
  .booking header { margin-bottom: 20px; }
  .booking h1 { font-size: 1.6rem; margin: 4px 0; }
  .lede { margin: 0; color: #5b6472; }
  .card {
    background: #fff;
    border: 1px solid #e3e7ef;
    border-radius: 14px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  }
  .card + .card { margin-top: 20px; }
  .form-title { font-size: 1.1rem; margin: 0 0 16px; }
  form { display: flex; flex-direction: column; gap: 16px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-weight: 600; font-size: 0.92rem; }
  input, select {
    width: 100%;
    font: inherit;
    padding: 10px 12px;
    border: 1px solid #c7ccd8;
    border-radius: 10px;
    background: #fff;
    color: inherit;
  }
  input:focus-visible, select:focus-visible {
    outline: 2px solid #2f6bff;
    outline-offset: 1px;
    border-color: #2f6bff;
  }
  .submit {
    margin-top: 4px;
    padding: 12px 16px;
    font: inherit;
    font-weight: 600;
    color: #fff;
    background: #2f6bff;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }
  .submit:disabled { background: #9db6ff; cursor: progress; }
  .message {
    margin: 0;
    color: #b42318;
    font-weight: 600;
  }
  .message:empty { display: none; }
  .confirmation {
    background: #ecfdf3;
    border-color: #abefc6;
  }
  .confirmation h2 { margin: 0 0 6px; font-size: 1.2rem; color: #067647; }
  .confirm-lede { margin: 0 0 14px; color: #275e46; }
  .confirmation dl {
    margin: 0 0 18px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
  }
  .confirmation dt { color: #5b6472; }
  .confirmation dd { margin: 0; font-weight: 600; word-break: break-word; }
  .edit {
    font: inherit;
    font-weight: 600;
    padding: 10px 14px;
    background: #fff;
    color: #067647;
    border: 1px solid #abefc6;
    border-radius: 10px;
    cursor: pointer;
  }
  @media (min-width: 900px) {
    .booking { max-width: 560px; padding-top: 48px; }
  }
`;

function loadBooking() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.date && parsed.time && parsed.guests) return parsed;
  } catch {
    // ignore unreadable / malformed storage
  }
  return null;
}

function friendlyDate(iso) {
  // Parse as a local date (avoid UTC off-by-one) and keep the raw ISO as a fallback.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function App() {
  const [booking, setBooking] = useState(loadBooking);
  const [date, setDate] = useState(() => booking?.date ?? '');
  const [time, setTime] = useState(() => booking?.time ?? '');
  const [guests, setGuests] = useState(() => (booking ? String(booking.guests) : '2'));
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dateRef = useRef(null);

  const showConfirmation = Boolean(booking) && !editing;

  // Once a booking exists, touching the form means the user is revising it:
  // hide the (now stale) confirmation banner until they submit again.
  function beginEdit() {
    if (booking && !editing) setEditing(true);
  }

  function handleEdit() {
    setEditing(true);
    setMessage('');
    requestAnimationFrame(() => dateRef.current && dateRef.current.focus());
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const partySize = Number(guests);
    if (!date) {
      setMessage('Please choose a date for your reservation.');
      return;
    }
    if (!time) {
      setMessage('Please choose a time for your reservation.');
      return;
    }
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 6) {
      setMessage('Please enter a party size between 1 and 6 guests.');
      return;
    }

    setMessage('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, time, guests: partySize }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (res.ok) {
        const saved = { id: data.id, date, time, guests: partySize };
        setBooking(saved);
        setEditing(false);
        setMessage('');
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // storage may be unavailable; the confirmation still shows for this session
        }
      } else {
        setMessage(data.error || 'We could not complete your reservation. Please try again.');
      }
    } catch {
      setMessage('We could not reach the reservation service. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const partySize = Number(booking?.guests);
  const guestWord = partySize === 1 ? 'guest' : 'guests';

  return (
    <>
      <style>{STYLES}</style>
      <main className="booking">
        <header>
          <h1>Reserve a table</h1>
          <p className="lede">Pick a date, a time, and how many are joining. We’ll hold your table right away.</p>
        </header>

        {showConfirmation && (
          <section className="card confirmation" data-testid="confirmation" role="status" aria-live="polite">
            <h2>Reservation confirmed</h2>
            <p className="confirm-lede">
              Your table for {booking.guests} {guestWord} is booked for {friendlyDate(booking.date)} at {booking.time}.
            </p>
            <dl>
              <dt>Date</dt>
              <dd>{booking.date}</dd>
              <dt>Time</dt>
              <dd>{booking.time}</dd>
              <dt>Party size</dt>
              <dd>{booking.guests} {guestWord}</dd>
            </dl>
            <button type="button" className="edit" data-testid="edit" onClick={handleEdit}>
              Edit reservation
            </button>
          </section>
        )}

        <section className="card">
          <h2 className="form-title">{booking ? 'Update your reservation' : 'Reservation details'}</h2>
          <form onSubmit={handleSubmit} noValidate>
            <label className="field">
              <span>Date</span>
              <input
                ref={dateRef}
                data-testid="date"
                type="date"
                value={date}
                onChange={e => { setDate(e.target.value); beginEdit(); }}
              />
            </label>
            <label className="field">
              <span>Time</span>
              <select
                data-testid="time"
                value={time}
                onChange={e => { setTime(e.target.value); beginEdit(); }}
              >
                <option value="">Select a time</option>
                {TIMES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Guests</span>
              <input
                data-testid="guests"
                type="number"
                min="1"
                max="6"
                step="1"
                inputMode="numeric"
                value={guests}
                onChange={e => { setGuests(e.target.value); beginEdit(); }}
              />
            </label>
            <button data-testid="submit" className="submit" type="submit" disabled={submitting}>
              {submitting ? 'Reserving…' : booking ? 'Update reservation' : 'Reserve'}
            </button>
            <p className="message" data-testid="message" role="alert" aria-live="assertive">{message}</p>
          </form>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
