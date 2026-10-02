import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'restaurant-reservation';
function validate({ date, time, guests }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return 'Please choose a valid date.';
  if (!Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > 8) return 'Please choose between 1 and 8 guests.';
  if (!TIMES.includes(time)) return 'Please choose a time.';
  if (Number(guests) >= 7 && time < '18:00') return 'Parties of 7 or 8 can book only at 18:00 or later. Please choose another time.';
  return '';
}
function loadBooking() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && !validate(saved) ? saved : null;
  } catch { return null; }
}
function App() {
  const [booking, setBooking] = useState(loadBooking);
  const [date, setDate] = useState(booking?.date || '');
  const [time, setTime] = useState(booking?.time || '');
  const [guests, setGuests] = useState(String(booking?.guests || 1));
  const [editing, setEditing] = useState(!booking);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  function changeGuests(value) {
    setGuests(value);
    if (Number(value) >= 7 && time === '17:00') {
      setTime('');
      setMessage('Parties of 7 or 8 can book only at 18:00 or later. Your previous time was cleared; please choose another time.');
    } else setMessage('');
  }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    const reservation = { date, time, guests: Number(guests) };
    const error = validate(reservation);
    if (error) { setMessage(error); return; }
    inFlight.current = true;
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reservation)
      });
      if (!response.ok) {
        setMessage(response.status === 409
          ? 'This time is sold out. Please choose another time or date.'
          : 'Reservation service unavailable. Please try again. Your selections have been kept.');
        return;
      }
      const result = await response.json();
      const confirmed = { ...reservation, id: result.id };
      setBooking(confirmed);
      setEditing(false);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmed)); }
      catch { setMessage('Your booking is confirmed, but could not be saved on this device. Keep these details before refreshing.'); }
    } catch {
      setMessage('Unable to reach the reservation service. Please try again. Your selections have been kept.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return <main>
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #f6f3ed; color: #263d32; font-family: system-ui, sans-serif; }
      main { width: min(100% - 32px, 640px); margin: 64px auto; padding: clamp(20px, 5vw, 48px); background: white; border: 1px solid #dedfd8; border-radius: 20px; }
      h1 { font-family: Georgia, serif; font-size: clamp(30px, 7vw, 42px); margin: 12px 0; }
      h2 { font-size: 24px; }
      p { line-height: 1.6; overflow-wrap: anywhere; }
      .eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: 12px; }
      .intro { color: #5e6b62; margin-bottom: 30px; }
      form, label { display: grid; gap: 10px; }
      form { gap: 22px; }
      label { font-weight: 600; min-width: 0; }
      input, select, button { font: inherit; width: 100%; min-width: 0; min-height: 48px; border-radius: 8px; }
      input, select { padding: 12px; border: 1px solid #8c9b90; background: white; color: #263d32; }
      button { padding: 12px 20px; border: 0; background: #294f3b; color: white; font-weight: 600; cursor: pointer; }
      button:disabled { opacity: .6; cursor: wait; }
      :focus-visible { outline: 3px solid #b8802f; outline-offset: 3px; }
      .hint { color: #5e6b62; font-size: 14px; margin: 0; }
      .message:not(:empty) { padding: 14px; background: #fff1d9; color: #754510; border-radius: 8px; }
      dl { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 22px 0; }
      dd { margin: 0; font-weight: 600; text-align: right; }
      @media (max-width: 480px) { main { margin: 24px auto; } }
    `}</style>
    <p className="eyebrow">An evening around the table</p>
    <h1>Reserve a table</h1>
    <p className="intro">Choose your date, time and party size. We look forward to welcoming you.</p>
    {editing ? <form onSubmit={submit} noValidate aria-busy={pending}>
      <label htmlFor="date">Date<input id="date" data-testid="date" type="date" required value={date} disabled={pending} onChange={e => { setDate(e.target.value); setMessage(''); }} /></label>
      <label htmlFor="time">Time<select id="time" data-testid="time" required value={time} disabled={pending} onChange={e => { setTime(e.target.value); setMessage(''); }}>
        <option value="">Select time</option>
        {TIMES.map(t => <option key={t} value={t} disabled={Number(guests) >= 7 && t === '17:00'}>{t}</option>)}
      </select></label>
      <label htmlFor="guests">Guests<select id="guests" data-testid="guests" value={guests} disabled={pending} aria-describedby="party-hint" onChange={e => changeGuests(e.target.value)}>
        {[1,2,3,4,5,6,7,8].map(count => <option key={count} value={String(count)}>{count}</option>)}
      </select></label>
      <p id="party-hint" className="hint">For 1–8 guests. Parties of 7 or 8 are welcome from 18:00.</p>
      <button data-testid="submit" type="submit" disabled={pending}>{pending ? 'Reserving…' : booking ? 'Save changes' : 'Reserve'}</button>
    </form> : <section data-testid="confirmation" aria-labelledby="confirmed-title">
      <h2 id="confirmed-title">Your booking is confirmed</h2>
      <dl><dt>Date</dt><dd>{booking.date}</dd><dt>Time</dt><dd>{booking.time}</dd><dt>Guests</dt><dd>{booking.guests}</dd></dl>
      <button data-testid="edit" type="button" onClick={() => { setDate(booking.date); setTime(booking.time); setGuests(String(booking.guests)); setMessage(''); setEditing(true); }}>Edit booking</button>
    </section>}
    <p data-testid="message" className="message" role="status" aria-live="polite">{message}</p>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
