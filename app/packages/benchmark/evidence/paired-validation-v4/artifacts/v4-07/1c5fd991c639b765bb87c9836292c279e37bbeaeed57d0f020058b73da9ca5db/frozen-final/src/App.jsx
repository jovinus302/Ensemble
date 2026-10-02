import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const availableTimes = ['17:00', '18:00', '19:00', '20:00'];
const storageKey = 'restaurant-reservation';
const partyTimeMessage = 'Parties of 7 or 8 guests can book only at or after 18:00. Please choose another time.';

function validateBooking({ date, time, guests }) {
  const count = Number(guests);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return 'Please choose a valid date.';
  if (!Number.isInteger(count) || count < 1 || count > 8) return 'Please enter a whole number of guests from 1 to 8.';
  if (!availableTimes.includes(time)) return 'Please choose a reservation time.';
  if (count >= 7 && time < '18:00') return partyTimeMessage;
  return '';
}

function loadBooking() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return saved && !validateBooking(saved) ? saved : null;
  } catch {
    return null;
  }
}

function App() {
  const [booking, setBooking] = useState(loadBooking);
  const [date, setDate] = useState(booking?.date || '');
  const [time, setTime] = useState(booking?.time || '');
  const [guests, setGuests] = useState(String(booking?.guests || 1));
  const [editing, setEditing] = useState(!booking);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  function changeGuests(value) {
    setGuests(value);
    if (Number(value) >= 7 && time === '17:00') {
      setTime('');
      setMessage(partyTimeMessage);
    } else {
      setMessage('');
    }
  }

  async function submitReservation(event) {
    event.preventDefault();
    if (submitting.current) return;
    const nextBooking = { date, time, guests: Number(guests) };
    const error = validateBooking(nextBooking);
    if (error) {
      setMessage(error);
      return;
    }
    submitting.current = true;
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextBooking),
      });
      if (!response.ok) {
        setMessage(response.status === 409
          ? 'This time is sold out. Please choose a different time or date.'
          : 'Reservation service unavailable. Please try again. Your selections have been kept.');
        return;
      }
      const result = await response.json();
      const confirmed = { ...nextBooking, id: result.id };
      try {
        localStorage.setItem(storageKey, JSON.stringify(confirmed));
        setMessage('');
      } catch {
        setMessage('Your booking is confirmed, but this browser could not save it for refresh. Please keep these details.');
      }
      setBooking(confirmed);
      setEditing(false);
    } catch {
      setMessage('We could not reach the reservation service. Please try again. Your selections have been kept.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <>
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #f6f4ee; color: #20372d; font-family: system-ui, sans-serif; }
      main { width: min(100% - 32px, 720px); margin: 64px auto; padding: 32px; background: #fff; border: 1px solid #dedfd6; border-radius: 16px; }
      h1 { margin: 0 0 12px; font-size: clamp(28px, 5vw, 36px); }
      .intro { margin: 0 0 28px; color: #536259; line-height: 1.6; }
      .fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
      label { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-weight: 600; }
      input, select, button { font: inherit; min-height: 48px; border-radius: 8px; }
      input, select { width: 100%; min-width: 0; padding: 10px; border: 1px solid #8c9b91; background: white; color: #20372d; }
      input:focus-visible, select:focus-visible, button:focus-visible { outline: 3px solid #b47c35; outline-offset: 3px; }
      .hint { margin: 12px 0 24px; color: #536259; font-size: 14px; }
      button { width: 100%; padding: 12px 20px; border: 0; background: #254e3d; color: white; cursor: pointer; font-weight: 600; }
      button:hover { background: #193c2c; }
      button:disabled { cursor: wait; opacity: .65; }
      fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
      [data-testid="message"] { line-height: 1.5; color: #8a341e; overflow-wrap: anywhere; }
      .confirmation { padding: 20px; margin-bottom: 20px; border-radius: 8px; background: #edf4ee; }
      .confirmation h2 { margin-top: 0; }
      .confirmation dl { display: grid; grid-template-columns: auto 1fr; gap: 12px 20px; }
      .confirmation dd { margin: 0; overflow-wrap: anywhere; }
      [data-testid="message"]:empty { margin: 0; }
      @media (max-width: 560px) { main { margin: 24px auto; padding: 24px; } .fields { grid-template-columns: 1fr; } }
    `}</style>
    <main>
      <h1>Reserve a table</h1>
      <p className="intro">{editing ? 'Choose a date, an evening time, and the size of your party.' : 'We look forward to welcoming you.'}</p>
      {!editing && booking ? <>
        <section className="confirmation" data-testid="confirmation" role="status">
          <h2>Booking confirmed</h2>
          <dl><dt>Date</dt><dd>{booking.date}</dd><dt>Time</dt><dd>{booking.time}</dd><dt>Guests</dt><dd>{booking.guests}</dd></dl>
        </section>
        <button data-testid="edit" type="button" onClick={() => {
          setDate(booking.date);
          setTime(booking.time);
          setGuests(String(booking.guests));
          setMessage('');
          setEditing(true);
        }}>Edit booking</button>
      </> : <form noValidate onSubmit={submitReservation} aria-busy={pending}>
        <fieldset disabled={pending} aria-label="Reservation details">
        <div className="fields">
          <label htmlFor="date">Date
            <input id="date" data-testid="date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label htmlFor="time">Time
            <select id="time" data-testid="time" required value={time} onChange={e => setTime(e.target.value)}>
              <option value="">Select time</option>
              {availableTimes.map(t => <option key={t} value={t} disabled={Number(guests) >= 7 && t === '17:00'}>{t}</option>)}
            </select>
          </label>
          <label htmlFor="guests">Guests
            <input id="guests" data-testid="guests" type="number" min="1" max="8" step="1" required aria-describedby="guests-hint" value={guests} onChange={e => changeGuests(e.target.value)} />
          </label>
        </div>
        <p id="guests-hint" className="hint">For parties of 1–8 guests. Parties of 7 or 8 can book from 18:00.</p>
        <button data-testid="submit" type="submit" disabled={pending}>{pending ? 'Saving…' : booking ? 'Save changes' : 'Reserve'}</button>
        </fieldset>
      </form>}
      <p data-testid="message" role="alert">{message}</p>
    </main>
  </>;
}
createRoot(document.getElementById('root')).render(<App />);

