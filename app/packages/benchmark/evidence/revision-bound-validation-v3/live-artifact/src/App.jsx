import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { styles } from './styles.js';
const TIMES = ['17:00','18:00','19:00','20:00'];
const KEY = 'restaurant-reservation-v1';
function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === v;
}
function validBooking(v) { return v && typeof v.id === 'string' && validDate(v.date) && TIMES.includes(v.time) && Number.isInteger(v.guests) && v.guests >= 1 && v.guests <= 6; }
function restore() { try { const v = JSON.parse(localStorage.getItem(KEY)); return validBooking(v) ? v : null; } catch { return null; } }
function App() {
  const [booking,setBooking] = useState(restore);
  const [date,setDate] = useState(booking?.date || '');
  const [time,setTime] = useState(booking?.time || '');
  const [guests,setGuests] = useState(String(booking?.guests || 1));
  const [editing,setEditing] = useState(!booking);
  const [message,setMessage] = useState('');
  const [pending,setPending] = useState(false);
  const lock = useRef(false), dateRef = useRef(null), confirmationRef = useRef(null);
  async function reserve(e) {
    e.preventDefault();
    if (lock.current) return;
    if (!validDate(date)) { setMessage('Please choose a valid reservation date.'); dateRef.current?.focus(); return; }
    if (!TIMES.includes(time)) { setMessage('Please select a dinner time.'); return; }
    const count = Number(guests);
    if (!Number.isInteger(count) || count < 1 || count > 6) { setMessage('Please enter a whole number of guests from 1 to 6.'); return; }
    lock.current = true; setPending(true); setMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch('/api/reservations', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({date,time,guests:count}), signal:controller.signal });
      if (!response.ok) {
        setMessage(response.status === 409 ? 'This time is sold out. Please choose another time or date.' : 'Reservation service unavailable. Please try again. Your selections have been kept.');
        return;
      }
      const result = await response.json();
      if (!validBooking(result)) throw new Error('Invalid response');
      setBooking(result); setEditing(false);
      try { localStorage.setItem(KEY,JSON.stringify(result)); }
      catch { setMessage('Your table is confirmed, but this browser could not save it. Please keep these details before refreshing.'); }
      requestAnimationFrame(() => confirmationRef.current?.focus());
    } catch { setMessage('We could not confirm your reservation. Please try again. Your selections have been kept.'); }
    finally { clearTimeout(timeout); lock.current = false; setPending(false); }
  }
  function edit() {
    setDate(booking.date); setTime(booking.time); setGuests(String(booking.guests)); setMessage(''); setEditing(true);
    requestAnimationFrame(() => dateRef.current?.focus());
  }
  return <><style>{styles}</style><div className="page">
    <header><a className="brand" href="/"><span aria-hidden="true">✳</span> olive & thyme.</a><span className="header-note">GOOD FOOD. GOOD COMPANY.</span></header>
    <main><section className="intro" aria-labelledby="page-title">
      <div className="eyebrow">● &nbsp; A SEAT AT OUR TABLE</div>
      <h1 id="page-title">Make time<br/>for <em>something<br/>delicious.</em></h1>
      <p className="intro-copy">Seasonal plates, thoughtful pours, and the people you love. We’ll save you a seat.</p>
      <div className="table-art" aria-hidden="true"><div className="napkin"/><div className="plate"><span>❧</span></div><div className="fork">Ⅲ<i/></div><div className="knife"/><div className="glass"/><span className="art-caption">A little slower. A little more together.</span></div>
      <div className="details"><div><span>DINNER, DAILY</span><p>17:00 – 20:00</p></div><div><span>COME TOGETHER</span><p>Tables for 1–6 guests</p></div></div>
    </section>
    <section className="booking-card" aria-labelledby="booking-title">
      <div className="card-top"><span className="eyebrow">YOUR EVENING STARTS HERE</span><span aria-hidden="true">↗</span></div>
      {editing ? <><h2 id="booking-title">Reserve a table</h2><p className="card-copy">A few details, and we’ll take care of the rest.</p>
        <form onSubmit={reserve} noValidate aria-busy={pending}><fieldset disabled={pending}>
          <label htmlFor="date">Date <span>Choose your day</span></label>
          <input id="date" ref={dateRef} data-testid="date" type="date" required value={date} onChange={e => {setDate(e.target.value);setMessage('');}} aria-describedby="reservation-message"/>
          <label htmlFor="time">Time <span>Make an evening of it</span></label>
          <select id="time" data-testid="time" required value={time} onChange={e => {setTime(e.target.value);setMessage('');}} aria-describedby="reservation-message"><option value="">Select a time</option>{TIMES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <label htmlFor="guests">Guests <span>Room for your favorite people</span></label>
          <div className="guest-row"><input id="guests" data-testid="guests" type="number" min="1" max="6" step="1" required value={guests} onChange={e => {setGuests(e.target.value);setMessage('');}} aria-describedby="guest-help reservation-message"/><span id="guest-help">1–6 guests per table</span></div>
          <button className="primary" data-testid="submit" type="submit">{pending ? 'Confirming your table…' : 'Reserve a table'}<span aria-hidden="true">{pending ? '◌' : '→'}</span></button>
        </fieldset></form>
      </> : <div data-testid="confirmation" ref={confirmationRef} tabIndex={-1} className="confirmation">
        <div className="success-icon" aria-hidden="true">✓</div><h2 id="booking-title">You’re on the list.</h2><p className="card-copy">Your table is confirmed. We look forward to having you.</p>
        <dl><div><dt>Date</dt><dd>{new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(`${booking.date}T12:00:00`))}<small>{booking.date}</small></dd></div><div><dt>Time</dt><dd>{booking.time}</dd></div><div><dt>Guests</dt><dd>{booking.guests} {booking.guests === 1 ? 'guest' : 'guests'}</dd></div></dl>
        <button className="primary" data-testid="edit" onClick={edit}>Edit reservation <span aria-hidden="true">↗</span></button>
      </div>}
      <p id="reservation-message" data-testid="message" role="status" aria-live="polite" className={message ? 'message visible' : 'message'}>{message}</p>
      <div className="card-footer"><span aria-hidden="true">✧</span><p>{editing ? 'Good company is all you need to bring.' : 'A lovely evening is waiting for you.'}</p></div>
    </section></main>
    <footer><span>SEASONAL. SIMPLE. SHARED.</span><span>olive & thyme · A place to come together</span></footer>
  </div></>;
}
createRoot(document.getElementById('root')).render(<App/>);
