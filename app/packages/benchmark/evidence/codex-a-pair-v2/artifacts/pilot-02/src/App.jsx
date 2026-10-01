import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'restaurant-reservation';
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validBooking(value) {
  return value && validDate(value.date) && TIMES.includes(value.time) && Number.isInteger(Number(value.guests)) && Number(value.guests) >= 1 && Number(value.guests) <= 6;
}
function readBooking() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return validBooking(saved) ? saved : null;
  } catch { return null; }
}
function displayDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function App() {
  const [booking, setBooking] = useState(readBooking);
  const [date, setDate] = useState(() => booking?.date || '');
  const [time, setTime] = useState(() => booking?.time || '');
  const [guests, setGuests] = useState(() => String(booking?.guests || 1));
  const [editing, setEditing] = useState(!booking);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const dateInput = useRef(null);
  const confirmation = useRef(null);
  function change(setter, value) { setter(value); setMessage(''); }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!validDate(date)) { setMessage('Please choose a valid date for your visit.'); dateInput.current?.focus(); return; }
    if (!TIMES.includes(time)) { setMessage('Please select a dinner time.'); return; }
    if (!Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > 6) { setMessage('Please enter a whole number of guests from 1 to 6.'); return; }
    inFlight.current = true;
    setPending(true);
    setMessage('');
    const details = { date, time, guests: Number(guests) };
    try {
      const response = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details) });
      if (!response.ok) {
        setMessage(response.status === 409 ? 'This time is sold out. Please choose another time or date.' : 'Reservation service unavailable. Please try again. Your selections have been kept.');
        return;
      }
      const result = await response.json();
      const saved = { ...details, id: result.id };
      setBooking(saved);
      setEditing(false);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
      catch { setMessage('Your table is confirmed, but this browser could not save it. Please keep a copy of these details.'); }
      requestAnimationFrame(() => confirmation.current?.focus());
    } catch { setMessage('We could not reach the reservation service. Please try again. Your selections have been kept.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  function edit() {
    setDate(booking.date); setTime(booking.time); setGuests(String(booking.guests));
    setMessage(''); setEditing(true);
    requestAnimationFrame(() => dateInput.current?.focus());
  }
  return <>
    <style>{styles}</style>
    <header className="header"><a href="/" className="brand" aria-label="Olive and Ember home"><span className="brand-icon">✳</span> OLIVE & EMBER</a><span className="header-note">GOOD FOOD. GREAT COMPANY.</span></header>
    <main>
      <section className="intro"><span className="eyebrow">A SEAT AT OUR TABLE</span><h1>Make time for<br /><em>something good.</em></h1><p>Seasonal plates, a warm welcome, and conversations that last a little longer. Your evening starts here.</p><div className="restaurant-art" aria-hidden="true"><div className="arch"><div className="sun"/><div className="vase"/><div className="stem s1"/><div className="stem s2"/><div className="stem s3"/><div className="table"/><div className="plate"/><div className="glass"/></div><span>GATHER. SAVOR. STAY A WHILE.</span></div><div className="visit-info"><span>DINNER, DAILY<br/><strong>17:00 – 21:30</strong></span><span>THOUGHTFULLY PREPARED<br/><strong>Seasonal & local</strong></span></div></section>
      <section className="booking-card" aria-label="Table reservation">
        <span className="eyebrow">YOU’RE ALWAYS WELCOME</span>
        {editing ? <><h2>Reserve a table</h2><p className="subtitle">A lovely evening is just a few details away.</p><form onSubmit={submit} noValidate aria-busy={pending}>
          <fieldset disabled={pending}><label htmlFor="date">Your date <span>01</span></label><input ref={dateInput} id="date" data-testid="date" type="date" required value={date} onChange={e => change(setDate, e.target.value)} />
          <label htmlFor="time">Dinner time <span>02</span></label><select id="time" data-testid="time" required value={time} onChange={e => change(setTime, e.target.value)}><option value="">Select a time</option>{TIMES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <label htmlFor="guests">Your party <span>03</span></label><div className="guest-field"><input id="guests" data-testid="guests" type="number" min="1" max="6" step="1" required value={guests} onChange={e => change(setGuests, e.target.value)} /><span>guests</span></div><p className="hint">For intimate gatherings of 1–6 guests.</p>
          <button data-testid="submit" type="submit">{pending ? 'Reserving your table…' : 'Reserve my table'}<span aria-hidden="true">↗</span></button></fieldset>
          <p className="fine-print">A little anticipation. A memorable evening.</p>
        </form></> : <div data-testid="confirmation" ref={confirmation} tabIndex="-1" className="confirmation"><div className="check" aria-hidden="true">✓</div><h2>Your table is ready.</h2><p className="subtitle">Your reservation is confirmed. We look forward to welcoming you.</p><dl><dt>Date</dt><dd>{displayDate(booking.date)}</dd><dt>Time</dt><dd>{booking.time}</dd><dt>Party</dt><dd>{booking.guests} {Number(booking.guests) === 1 ? 'guest' : 'guests'}</dd></dl><button type="button" data-testid="edit" onClick={edit}>Edit reservation <span aria-hidden="true">↗</span></button></div>}
        <p data-testid="message" className={message ? 'message' : 'empty-message'} role="status" aria-live="polite">{message}</p>
        <div className="card-footer"><span aria-hidden="true">✳</span> Come as you are. We’ll take care of the rest.</div>
      </section>
    </main><footer><span>OLIVE & EMBER</span><span>Something worth gathering for.</span></footer>
  </>;
}
const styles = `
*{box-sizing:border-box}body{margin:0;background:#f6f4ed;color:#283b30;font-family:Arial,Helvetica,sans-serif}button,input,select{font:inherit}a{color:inherit;text-decoration:none}.header{max-width:1320px;margin:auto;padding:34px 48px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9ddd2}.brand{font-size:17px;font-weight:700;letter-spacing:2px;display:flex;align-items:center;gap:12px}.brand-icon{font-size:35px;font-weight:normal}.header-note,.eyebrow{font-size:10px;letter-spacing:2px;font-weight:700}.header-note{color:#70786b}main{max-width:1180px;margin:70px auto 76px;padding:0 40px;display:grid;grid-template-columns:1fr 440px;gap:92px;align-items:start}.eyebrow{color:#788061}h1{font:54px/1.13 Georgia,serif;letter-spacing:-1.7px;margin:22px 0}h1 em{font-weight:normal;color:#788061}p{font-size:14px;line-height:1.8}.intro>p{max-width:380px;color:#6c7368}.restaurant-art{height:230px;background:#e9e8db;margin-top:28px;position:relative;overflow:hidden;border-radius:3px}.arch{position:absolute;width:220px;height:230px;background:#d9ddc7;border-radius:120px 120px 0 0;left:50%;top:25px;transform:translateX(-50%);overflow:hidden}.sun{width:64px;height:64px;background:#eeb879;border-radius:50%;position:absolute;left:38px;top:29px}.table{position:absolute;background:#b78f6d;bottom:0;height:70px;width:100%;border-radius:50% 50% 0 0}.plate{position:absolute;width:95px;height:24px;border:5px solid #f4f0df;border-radius:50%;bottom:38px;left:23px;background:#d1d1b3}.vase{position:absolute;width:41px;height:61px;border-radius:8px 8px 20px 20px;background:#9c634a;bottom:56px;right:39px;z-index:2}.stem{position:absolute;width:3px;height:92px;background:#69785a;right:59px;bottom:111px;transform-origin:bottom;transform:rotate(-27deg)}.s2{transform:rotate(20deg);height:106px}.s3{transform:rotate(49deg);height:80px}.stem:before,.stem:after{content:'';position:absolute;width:25px;height:11px;border-radius:100% 0 100% 0;background:#69785a;top:20px;left:0}.stem:after{top:45px;left:-23px}.glass{position:absolute;width:25px;height:36px;border:2px solid #f4f0df;bottom:44px;left:125px;border-radius:0 0 10px 10px}.restaurant-art>span{position:absolute;font-size:8px;letter-spacing:2px;bottom:17px;left:15px;writing-mode:vertical-rl;transform:rotate(180deg)}.visit-info{display:flex;gap:46px;margin-top:24px;font-size:9px;line-height:1.8;letter-spacing:1px;color:#7c8372}.visit-info strong{font-size:12px;font-weight:normal;letter-spacing:0;color:#384939}.booking-card{background:#fffefa;border:1px solid #e5e5d9;border-radius:6px;padding:35px 34px 0;box-shadow:0 12px 40px #34472c08}h2{font:32px/1.2 Georgia,serif;margin:14px 0 10px;letter-spacing:-.7px}.subtitle{color:#788071;font-size:12px;margin-bottom:27px}fieldset{border:0;margin:0;padding:0;min-width:0}label{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;margin:23px 0 10px}label span{font-size:10px;font-weight:normal;color:#a1a58f}input,select{display:block;width:100%;min-width:0;height:49px;border:1px solid #d8ddcf;background:#fffefa;color:#344332;border-radius:3px;padding:0 13px;font-size:14px;color-scheme:light}input:focus,select:focus,button:focus-visible,a:focus-visible{outline:2px solid #8a985b;outline-offset:3px}.guest-field{position:relative}.guest-field input{padding-right:90px}.guest-field>span{position:absolute;right:35px;top:17px;font-size:12px;color:#7b8372;pointer-events:none}.hint{font-size:10px;color:#838977;margin:8px 0 24px}button{width:100%;border:0;border-radius:3px;background:#314b36;color:#fff;padding:17px 19px;display:flex;justify-content:space-between;align-items:center;font-size:13px;cursor:pointer}button:hover{background:#426047}button:disabled{opacity:.6;cursor:wait}.fine-print{font-size:10px;text-align:center;color:#8a907f;margin:14px 0 24px}.card-footer{border-top:1px solid #e6e7dd;margin-top:20px;padding:20px 0;font-size:10px;color:#7c8572;display:flex;align-items:center;gap:9px}.card-footer>span{font-size:22px}.message{color:#923e29;background:#fbede4;border:1px solid #eed3c2;padding:12px;font-size:12px;border-radius:3px;overflow-wrap:anywhere}.empty-message{margin:0}.check{border-radius:50%;background:#e8edde;width:48px;height:48px;display:grid;place-items:center;font-size:25px;margin:28px 0 22px}.confirmation:focus{outline:none}dl{padding:20px;background:#f5f5ed;border-radius:3px;margin:25px 0}dt{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#788071;margin-top:18px}dt:first-child{margin-top:0}dd{margin:6px 0 0;font-size:14px;line-height:1.6}footer{max-width:1224px;margin:auto;border-top:1px solid #d9ddd2;padding:24px 8px 30px;display:flex;justify-content:space-between;font-size:10px;color:#868c7b}footer>span:first-child{letter-spacing:1.5px;font-weight:bold}@media(min-width:1300px){main{margin-top:80px}}@media(max-width:900px){main{gap:35px;grid-template-columns:1fr 380px;padding:0 28px}h1{font-size:43px}.booking-card{padding:28px 25px 0}.header{padding:25px 28px}footer{margin:0 28px}}@media(max-width:700px){.header{padding:20px 22px}.brand{font-size:13px;letter-spacing:1.6px}.brand-icon{font-size:28px}.header-note{display:none}main{display:flex;flex-direction:column;gap:28px;margin:34px auto 40px;padding:0 22px}.intro{width:100%}h1{font-size:43px;margin:16px 0}.intro>p{font-size:13px;max-width:420px}.restaurant-art{height:150px;margin-top:22px}.arch{top:0;transform:translateX(-50%) scale(.8);transform-origin:top}.visit-info{gap:35px;margin-top:16px}.booking-card{width:100%;padding:27px 23px 0}h2{font-size:30px}footer{margin:0 22px;padding:20px 0;gap:20px;font-size:9px}.eyebrow{font-size:9px}input,select{font-size:16px}.card-footer{font-size:9px}}
`;
createRoot(document.getElementById('root')).render(<App />);
