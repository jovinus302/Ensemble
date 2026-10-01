// Harness validation ONLY. This is not a model-produced benchmark result.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
const maxGuests = __BENCH_TASK__ === 'A' ? 6 : 8;
function App() {
  const [saved, setSaved] = useState(() => JSON.parse(localStorage.getItem('booking') || 'null'));
  const [date, setDate] = useState(saved?.date || ''); const [time, setTime] = useState(saved?.time || '');
  const [guests, setGuests] = useState(saved?.guests || 1); const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(Boolean(saved));
  async function submit(e) {
    e.preventDefault(); setMessage('');
    if (!date || !time || guests < 1 || guests > maxGuests || (guests >= 7 && time < '18:00')) { setMessage('Select a valid date, time and 1–8 guests. Large groups require 18:00 or later.'); return; }
    try {
      const response = await fetch('/api/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date, time, guests: Number(guests) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      localStorage.setItem('booking', JSON.stringify(data)); setSaved(data); setConfirmed(true);
    } catch (error) { setMessage(error.message); }
  }
  return <main><style>{`*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:#f3f5f8;color:#172238}main{width:min(100%,600px);padding:24px;margin:auto}label{display:block;margin:16px 0}input,select,button{display:block;width:100%;padding:12px;font:inherit}button{background:#173d70;color:white;border:0;border-radius:8px}p{overflow-wrap:anywhere}`}</style><h1>Reserve a table</h1>
    {confirmed ? <section data-testid="confirmation"><h2>Reservation confirmed</h2><p>{saved.date} at {saved.time} · {saved.guests} guests</p><button data-testid="edit" onClick={() => setConfirmed(false)}>Edit reservation</button></section> : <form onSubmit={submit}>
      <label>Date<input required data-testid="date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Time<select required data-testid="time" value={time} onChange={e => setTime(e.target.value)}><option value="">Select time</option>{['17:00','18:00','19:00','20:00'].map(t => <option key={t} disabled={guests >= 7 && t < '18:00'}>{t}</option>)}</select></label>
      <label>Guests<input required data-testid="guests" type="number" min="1" max={maxGuests} value={guests} onChange={e => { const n = Number(e.target.value); setGuests(n); if (n >= 7 && time && time < '18:00') { setTime(''); setMessage('Time cleared: groups of 7–8 guests require 18:00 or later.'); } }} /></label>
      <button data-testid="submit" type="submit">Reserve</button>
    </form>}<p data-testid="message" role="status">{message}</p>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);

