import { useState } from 'react';
import { createRoot } from 'react-dom/client';

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'ensemble.reservation';

const styles = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f4f6f9;
    color: #1b1f24;
    line-height: 1.5;
  }
  main.booking {
    max-width: 460px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }
  @media (min-width: 900px) { main.booking { margin-top: 48px; } }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .lede { margin: 0 0 20px; color: #58616e; }
  .card {
    background: #fff;
    border: 1px solid #e2e6ec;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(16, 24, 40, 0.06);
  }
  form { display: flex; flex-direction: column; gap: 16px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-weight: 600; font-size: 0.9rem; }
  input, select {
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    font-size: 1rem;
    border: 1px solid #b7bfca;
    border-radius: 8px;
    background: #fff;
    color: inherit;
  }
  input:focus, select:focus {
    outline: 2px solid #2b6cb0;
    outline-offset: 1px;
    border-color: #2b6cb0;
  }
  button {
    min-height: 44px;
    padding: 10px 16px;
    font-size: 1rem;
    font-weight: 600;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
  }
  button[type="submit"] { background: #2b6cb0; color: #fff; }
  button[type="submit"]:disabled { opacity: 0.6; cursor: progress; }
  .edit-btn { background: #eef1f5; color: #1b1f24; margin-top: 16px; }
  .message { margin: 2px 0 0; min-height: 1.3em; font-size: 0.95rem; }
  .message.error { color: #b22020; font-weight: 600; }
  .confirmation h2 { margin: 0 0 6px; font-size: 1.2rem; color: #1a7a3c; }
  .confirmation p { margin: 0; color: #58616e; }
  .confirmation dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    margin: 16px 0 0;
  }
  .confirmation dt { font-weight: 600; color: #58616e; }
  .confirmation dd { margin: 0; word-break: break-word; }
`;

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const [booking, setBooking] = useState(readSaved);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState('2');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!date) { setMessage('Please choose a date for your reservation.'); return; }
    if (!time) { setMessage('Please choose a time for your reservation.'); return; }
    const partySize = Number(guests);
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
      try { data = await res.json(); } catch { /* non-JSON body */ }

      if (res.ok) {
        const saved = {
          id: data.id,
          date: data.date ?? date,
          time: data.time ?? time,
          guests: data.guests ?? partySize,
        };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ }
        setBooking(saved);
        setMessage('');
      } else {
        setMessage(data.error || 'We could not complete your reservation. Please try again.');
      }
    } catch {
      setMessage('We could not reach the reservation service. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    if (booking) {
      setDate(booking.date || '');
      setTime(booking.time || '');
      setGuests(String(booking.guests ?? '2'));
    }
    setMessage('');
    setBooking(null);
  }

  if (booking) {
    return (
      <main className="booking">
        <style>{styles}</style>
        <h1>Reserve a table</h1>
        <div className="card confirmation" data-testid="confirmation">
          <h2>Reservation confirmed</h2>
          <p>Your table is booked. You can edit the details below.</p>
          <dl>
            <dt>Date</dt><dd>{booking.date}</dd>
            <dt>Time</dt><dd>{booking.time}</dd>
            <dt>Guests</dt><dd>{booking.guests}</dd>
          </dl>
          <button type="button" className="edit-btn" data-testid="edit" onClick={handleEdit}>
            Edit reservation
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="booking">
      <style>{styles}</style>
      <h1>Reserve a table</h1>
      <p className="lede">Book a table for 1 to 6 guests.</p>
      <form className="card" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Date</span>
          <input
            data-testid="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Time</span>
          <select
            data-testid="time"
            value={time}
            onChange={e => setTime(e.target.value)}
          >
            <option value="">Select a time</option>
            {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
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
            value={guests}
            onChange={e => setGuests(e.target.value)}
          />
        </label>
        <button data-testid="submit" type="submit" disabled={submitting}>
          {submitting ? 'Reserving…' : 'Reserve'}
        </button>
        <p
          className={`message${message ? ' error' : ''}`}
          data-testid="message"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
