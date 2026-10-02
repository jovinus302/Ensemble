import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

// Reservation app: date/time/guests controls, server submission against the
// local /api/reservations fixture, visible errors, confirmation, edit flow and
// persistence that survives a refresh.

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const MIN_GUESTS = 1;
const MAX_GUESTS = 8;
const LARGE_PARTY = 7; // parties of this size or larger
const EARLIEST_LARGE = '18:00'; // large parties may book only at/after this time
const STORAGE_KEY = 'reservation:booking';

const GUESTS_RANGE_MSG = `Please choose between ${MIN_GUESTS} and ${MAX_GUESTS} guests.`;
const LARGE_PARTY_MSG = `Parties of ${LARGE_PARTY} or more can book only at ${EARLIEST_LARGE} or later.`;
const LARGE_PARTY_CLEARED_MSG = `Parties of ${LARGE_PARTY} or more can book only at ${EARLIEST_LARGE} or later, so we cleared your time. Please choose ${EARLIEST_LARGE} or later.`;

// Times (zero-padded "HH:MM") compare correctly as plain strings.
function timeAllowedForGuests(time, guests) {
  if (!time) return true;
  const n = Number(guests);
  if (n >= LARGE_PARTY && time < EARLIEST_LARGE) return false;
  return true;
}

function validateGuests(guests) {
  const n = Number(guests);
  if (!Number.isInteger(n) || n < MIN_GUESTS || n > MAX_GUESTS) return GUESTS_RANGE_MSG;
  return '';
}

function loadBooking() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const [confirmation, setConfirmation] = useState(loadBooking);
  const [date, setDate] = useState(() => (confirmation ? confirmation.date : ''));
  const [time, setTime] = useState(() => (confirmation ? confirmation.time : ''));
  const [guests, setGuests] = useState(() => (confirmation ? String(confirmation.guests) : '2'));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleGuestsChange(e) {
    const value = e.target.value;
    setGuests(value);
    const rangeError = validateGuests(value);
    if (rangeError) {
      setMessage(rangeError);
      return;
    }
    // The party size can make an already-chosen time invalid: clear it + explain.
    if (time && !timeAllowedForGuests(time, value)) {
      setTime('');
      setMessage(LARGE_PARTY_CLEARED_MSG);
      return;
    }
    setMessage('');
  }

  function handleTimeChange(e) {
    const value = e.target.value;
    if (value && !timeAllowedForGuests(value, guests)) {
      setTime('');
      setMessage(LARGE_PARTY_MSG);
      return;
    }
    setTime(value);
    setMessage('');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const rangeError = validateGuests(guests);
    if (rangeError) { setMessage(rangeError); return; }
    if (!date) { setMessage('Please choose a date.'); return; }
    if (!time) { setMessage('Please choose a time.'); return; }
    if (!timeAllowedForGuests(time, guests)) { setMessage(LARGE_PARTY_MSG); return; }

    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, time, guests: Number(guests) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const booking = { id: data.id, date, time, guests: Number(guests) };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(booking)); } catch {}
        setConfirmation(booking);
        setMessage('');
      } else {
        setMessage((data && data.error) || 'Something went wrong. Please try again.');
      }
    } catch {
      setMessage('Could not reach the reservation service. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    // Keep the confirmed values in the form so they can be adjusted.
    setDate(confirmation.date);
    setTime(confirmation.time);
    setGuests(String(confirmation.guests));
    setConfirmation(null);
    setMessage('');
  }

  return (
    <main>
      <style>{STYLES}</style>
      <h1>Reserve a table</h1>

      {confirmation ? (
        <section className="confirmation" data-testid="confirmation">
          <h2>You're booked!</h2>
          <dl>
            <dt>Date</dt><dd>{confirmation.date}</dd>
            <dt>Time</dt><dd>{confirmation.time}</dd>
            <dt>Guests</dt><dd>{confirmation.guests}</dd>
          </dl>
          <button type="button" data-testid="edit" onClick={handleEdit}>Edit reservation</button>
        </section>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>Date
            <input
              data-testid="date"
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setMessage(''); }}
            />
          </label>

          <label>Time
            <select data-testid="time" value={time} onChange={handleTimeChange}>
              <option value="">Select a time</option>
              {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label>Guests
            <input
              data-testid="guests"
              type="number"
              min={MIN_GUESTS}
              max={MAX_GUESTS}
              step="1"
              value={guests}
              onChange={handleGuestsChange}
            />
          </label>

          <button data-testid="submit" type="submit" disabled={submitting}>
            {submitting ? 'Reserving…' : 'Reserve'}
          </button>

          <p data-testid="message" role="status" aria-live="polite" className={message ? 'message is-error' : 'message'}>
            {message}
          </p>
        </form>
      )}
    </main>
  );
}

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f6f8;
    color: #1b1f24;
    line-height: 1.4;
  }
  main {
    max-width: 440px;
    margin: 0 auto;
    padding: 24px 16px 48px;
  }
  h1 { font-size: 1.5rem; margin: 0 0 20px; }
  h2 { font-size: 1.25rem; margin: 0 0 12px; }
  form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
  input, select, button {
    font-size: 1rem;
    font-family: inherit;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #c4c9d1;
    width: 100%;
    background: #fff;
    color: inherit;
  }
  button[data-testid="submit"], .confirmation button {
    background: #1f6feb;
    color: #fff;
    border-color: #1f6feb;
    font-weight: 600;
    cursor: pointer;
    width: auto;
    align-self: flex-start;
  }
  button:disabled { opacity: .6; cursor: default; }
  .message { min-height: 1.3em; margin: 0; font-weight: 600; }
  .message.is-error { color: #b42318; }
  .confirmation {
    background: #e7f8ee;
    border: 1px solid #1f9d55;
    border-radius: 12px;
    padding: 20px;
  }
  .confirmation dl {
    margin: 0 0 16px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
  }
  .confirmation dt { font-weight: 600; }
  .confirmation dd { margin: 0; }
`;

createRoot(document.getElementById('root')).render(<App />);
