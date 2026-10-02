import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'restaurant-reservation';
function validBooking(value) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && !Number.isNaN(Date.parse(value.date + 'T12:00:00')) && TIMES.includes(value.time) && Number.isInteger(Number(value.guests)) && Number(value.guests) >= 1 && Number(value.guests) <= 6;
}
function readBooking() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); return validBooking(saved) ? saved : null; }
  catch { return null; }
}
function formatDate(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function App() {
  const [booking, setBooking] = useState(readBooking);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(booking?.date || '');
  const [time, setTime] = useState(booking?.time || '');
  const [guests, setGuests] = useState(String(booking?.guests || 1));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const confirmed = booking && !editing;
  async function reserve(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!date) { setMessage('Please choose a date for your visit.'); return; }
    if (!TIMES.includes(time)) { setMessage('Please choose a dinner time.'); return; }
    if (!validBooking({ date, time, guests })) { setMessage('Please enter a valid date and a whole number of guests from 1 to 6.'); return; }
    submitting.current = true;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time, guests: Number(guests) }), signal: controller.signal,
      });
      if (!response.ok) {
        setMessage(response.status === 409 ? 'This time is sold out. Please choose another time or date.' : 'Reservation service unavailable. Please try again. Your details are still here.');
        return;
      }
      const result = await response.json();
      if (!validBooking(result)) throw new Error('Invalid reservation response');
      setBooking(result);
      setEditing(false);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); }
      catch { setMessage('Your table is booked, but this browser could not save it. Keep these confirmation details before refreshing.'); }
    } catch {
      setMessage('We could not confirm your reservation. Please check your connection and try again.');
    } finally {
      clearTimeout(timeout);
      submitting.current = false;
      setBusy(false);
    }
  }
  function change(setter) { return event => { setter(event.target.value); setMessage(''); }; }
  return <>
    <style>{styles}</style>
    <header className="header"><a href="/" className="brand" aria-label="Olive and Oak home"><span className="brand-icon">✳</span> olive & oak<span className="brand-dot">.</span></a><span className="header-note">GOOD FOOD. GOOD COMPANY.</span></header>
    <main>
      <section className="intro"><span className="eyebrow">A PLACE AT OUR TABLE</span><h1>A little time.<br />A lovely meal.</h1><p>Seasonal plates, familiar faces, and an evening worth slowing down for. We’ll save you a seat.</p><div className="restaurant-art" aria-hidden="true"><div className="art-label">FRESH & SEASONAL<br /><span>Made to be shared</span></div><div className="plate"><div className="food leaf-one"></div><div className="food leaf-two"></div><div className="food leaf-three"></div><div className="tomato one"></div><div className="tomato two"></div><div className="food leaf-four"></div></div><div className="napkin"></div><div className="fork">↟</div><span className="art-caption">THE BEST EVENINGS START AROUND A TABLE.</span></div><div className="visit-details"><span>DINNER, EVERY DAY</span><span>17:00 – 20:00</span></div></section>
      <section className="booking-card" aria-labelledby="booking-title">
        <span className="eyebrow">YOUR EVENING STARTS HERE</span>
        <h2 id="booking-title">{confirmed ? 'You’re on the list.' : editing ? 'Edit your reservation' : 'Reserve a table'}</h2>
        <p className="card-description">{confirmed ? 'We look forward to welcoming you to olive & oak.' : 'Pick a date, bring your people. We’ll take care of the rest.'}</p>
        {confirmed ? <div data-testid="confirmation" className="confirmation" role="status"><div className="success-icon">✓</div><h3>Reservation confirmed</h3><dl><div><dt>Date</dt><dd>{formatDate(booking.date)}</dd></div><div><dt>Time</dt><dd>{booking.time}</dd></div><div><dt>Guests</dt><dd>{booking.guests} {Number(booking.guests) === 1 ? 'guest' : 'guests'}</dd></div></dl><button data-testid="edit" className="primary" onClick={() => { setEditing(true); setMessage(''); }}>Edit reservation <span aria-hidden="true">↗</span></button></div> : <form onSubmit={reserve} noValidate>
          <fieldset disabled={busy}><label htmlFor="date">Your date</label><input id="date" data-testid="date" type="date" required value={date} onChange={change(setDate)} aria-describedby="message" />
          <div className="form-row"><div><label htmlFor="time">Dinner time</label><select id="time" data-testid="time" required value={time} onChange={change(setTime)} aria-describedby="message"><option value="">Select time</option>{TIMES.map(t => <option key={t} value={t}>{t}</option>)}</select></div><div><label htmlFor="guests">Party size</label><input id="guests" data-testid="guests" type="number" min="1" max="6" step="1" required value={guests} onChange={change(setGuests)} aria-describedby="message" /></div></div>
          <div className="booking-note"><span aria-hidden="true">◷</span><span>A table for your evening, in just a few clicks.<br />Reservations available for up to 6 guests.</span></div>
          <button data-testid="submit" className="primary" type="submit" disabled={busy}>{busy ? 'Reserving your table…' : editing ? 'Save reservation' : 'Reserve a table'}<span aria-hidden="true">↗</span></button>
          </fieldset>{editing && <button type="button" className="cancel" disabled={busy} onClick={() => { setDate(booking.date); setTime(booking.time); setGuests(String(booking.guests)); setEditing(false); setMessage(''); }}>Keep current reservation</button>}
        </form>}
        <p id="message" data-testid="message" role="alert" className={message ? 'message visible' : 'message'}>{message}</p>
        <div className="card-footer"><span aria-hidden="true">✧</span> A seat for every occasion.</div>
      </section>
    </main><footer className="footer"><span>olive & oak · Come hungry. Leave happy.</span><span>Thoughtfully made, warmly served.</span></footer>
  </>;
}
const styles = `
*{box-sizing:border-box}body{margin:0;background:#f8f7f2;color:#283c30;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}button{cursor:pointer}button:disabled{cursor:wait;opacity:.65}a{color:inherit;text-decoration:none}.header{max-width:1280px;margin:auto;padding:32px 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dedfd5}.brand{font-family:Georgia,serif;font-size:30px;font-weight:bold;letter-spacing:-1.5px}.brand-icon{font-size:36px;vertical-align:middle;margin-right:10px;color:#74844b}.brand-dot{color:#bc744a}.header-note{font-size:10px;letter-spacing:2px;color:#788071}main{max-width:1184px;margin:66px auto 74px;display:grid;grid-template-columns:1.05fr 1fr;gap:96px;align-items:start;padding:0 28px}.eyebrow{font-size:10px;letter-spacing:2px;font-weight:bold;color:#79815c}h1{font-family:Georgia,serif;font-size:64px;line-height:1.09;letter-spacing:-2px;font-weight:normal;margin:20px 0} .intro>p{font-size:15px;line-height:1.8;color:#737a6e;max-width:380px;margin:0 0 30px}.restaurant-art{height:244px;background:#e7e7da;position:relative;overflow:hidden;border-radius:3px}.plate{position:absolute;width:228px;height:228px;border-radius:50%;background:#eeeadb;box-shadow:0 8px 20px #62674926,inset 0 0 0 15px #f9f6eb,inset 0 0 0 17px #dfddcf;right:28px;top:-12px;transform:rotate(-20deg)}.food{position:absolute;width:77px;height:34px;background:#66794d;border-radius:100% 0 100% 0;box-shadow:inset 0 -5px 8px #30442630}.leaf-one{top:63px;left:49px;transform:rotate(20deg)}.leaf-two{top:109px;left:104px;transform:rotate(80deg);background:#879656}.leaf-three{top:127px;left:52px;transform:rotate(-35deg)}.leaf-four{top:88px;left:98px;transform:rotate(-50deg);background:#abb271}.tomato{position:absolute;width:29px;height:28px;border-radius:50%;background:#b66d4c;box-shadow:inset 4px 3px #cf8c61}.one{left:85px;top:85px}.two{left:91px;top:142px}.napkin{position:absolute;width:74px;height:184px;background:#b6b99c;left:27px;top:104px;transform:rotate(23deg);opacity:.7}.fork{position:absolute;left:63px;top:104px;font-size:100px;color:#69765b;transform:rotate(23deg)}.art-label{position:absolute;top:24px;left:22px;font-size:9px;letter-spacing:2px;z-index:1;line-height:1.6}.art-label span{font-family:Georgia,serif;font-size:14px;letter-spacing:0}.art-caption{position:absolute;bottom:18px;right:18px;font-size:8px;letter-spacing:1.3px}.visit-details{display:flex;justify-content:space-between;font-size:10px;letter-spacing:1.3px;margin-top:17px;color:#747d6e}.booking-card{background:#fffefa;border:1px solid #e3e3d8;border-radius:8px;padding:38px 36px 0;box-shadow:0 12px 32px #35433106;margin-top:10px}h2{font-family:Georgia,serif;font-size:34px;font-weight:normal;letter-spacing:-1px;margin:15px 0 12px}.card-description{color:#7a7e71;font-size:13px;line-height:1.7;margin-bottom:29px;max-width:330px}fieldset{border:0;margin:0;padding:0;min-width:0}label{display:block;font-size:12px;font-weight:bold;margin-bottom:10px}input,select{width:100%;min-width:0;height:49px;border:1px solid #d8dcd0;border-radius:4px;background:#fffefa;padding:0 12px;color:#354234;font-size:13px;display:block}input:focus,select:focus,button:focus-visible,a:focus-visible{outline:2px solid #7c8f60;outline-offset:3px}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:21px}.booking-note{display:flex;gap:11px;align-items:center;background:#f4f5ed;border-radius:4px;margin:25px 0;padding:14px 12px;font-size:11px;color:#76816b;line-height:1.7}.booking-note>span:first-child{font-size:24px}.primary{width:100%;display:flex;align-items:center;justify-content:space-between;background:#334b37;color:white;border:0;border-radius:4px;min-height:49px;padding:14px 18px;font-size:13px}.primary:hover{background:#263c2b}.primary span{font-size:20px}.message{margin:0}.message.visible{background:#fff1e8;color:#904729;border:1px solid #edd2c2;padding:12px;border-radius:4px;font-size:13px;line-height:1.6;margin-top:16px}.card-footer{border-top:1px solid #e9e9df;margin-top:28px;padding:20px 0;text-align:center;font-size:11px;color:#8a8d7c}.card-footer span{margin-right:7px}.footer{max-width:1184px;margin:auto;border-top:1px solid #dedfd5;padding:23px 0 28px;display:flex;justify-content:space-between;font-size:10px;color:#858b7d}.confirmation h3{font-family:Georgia,serif;font-size:23px;font-weight:normal}.success-icon{width:42px;height:42px;background:#e9efdf;border-radius:50%;display:grid;place-items:center;font-size:22px}dl{margin:24px 0}dl>div{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #e9e9df;padding:12px 0;font-size:13px}dt{color:#7a7e71}dd{margin:0;text-align:right;line-height:1.5}.cancel{display:block;margin:15px auto 0;border:0;background:transparent;color:#58694a;text-decoration:underline;font-size:12px;padding:6px}
@media(min-width:1400px){main{margin-top:80px;margin-bottom:85px}}@media(max-width:850px){main{gap:36px;padding:0 24px}.header{padding:25px 24px}h1{font-size:49px}.booking-card{padding:28px 24px 0}.footer{margin:0 24px}.header-note{font-size:8px}}@media(max-width:620px){.header{padding:19px 22px}.brand{font-size:27px}.header-note{display:none}main{display:flex;flex-direction:column;gap:28px;margin:32px auto;padding:0 22px}.intro,.booking-card{width:100%}h1{font-size:47px;margin:15px 0}.intro>p{font-size:14px;margin-bottom:22px}.restaurant-art{height:160px}.plate{width:210px;height:210px;right:8px;top:-37px}.art-label{left:15px;top:15px;font-size:8px}.art-label span{font-size:12px}.art-caption{font-size:7px;right:10px;bottom:10px}.napkin{left:10px;top:70px}.fork{left:38px;top:68px}.booking-card{margin:0;padding:26px 22px 0}h2{font-size:30px}.footer{margin:0 22px;padding:20px 0;gap:15px;flex-direction:column}.form-row{gap:12px}.visit-details{font-size:9px}input,select{font-size:16px}}
`;
createRoot(document.getElementById('root')).render(<App />);

