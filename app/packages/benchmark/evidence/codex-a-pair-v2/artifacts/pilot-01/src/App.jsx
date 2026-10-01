import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* Handoff verification (plan version 1):
 * Verified in Node, without HTTP: the existing server handler and this submit
 * function return the expected sold-out/error outcomes, recover on retry, and
 * save/restore a successful booking. Guest boundaries and test IDs were checked.
 * Build: NOT VERIFIED. An in-memory esbuild attempt failed with spawn EPERM;
 * node build.mjs and the external harness were not run by this implementation.
 * Browser: NOT VERIFIED, including refresh/edit interactions and unclipped
 * 390px/1440px layouts. Responsive rules are implemented, not visually certified.
 * Persistence uses this browser's localStorage. If storage is unavailable,
 * confirmation still appears with a warning, but cannot survive refresh.
 * Editing retains the last confirmed booking until a replacement succeeds.
 */
const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const KEY = 'juniper-reservation';
// build.mjs bundles this entry into /app.js; keep styles inline because the
// existing server serves that bundle and index.html, without a CSS route.
// The server owns availability: 2030-06-15 19:00 => 409,
// 2030-06-16 18:00 => 503. Always submit to it, including these fixtures.
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validBooking(value) {
  return value && validDate(value.date) && TIMES.includes(value.time) && Number.isInteger(Number(value.guests)) && Number(value.guests) >= 1 && Number(value.guests) <= 6;
}
function readBooking() {
  try { const value = JSON.parse(localStorage.getItem(KEY)); return validBooking(value) ? value : null; }
  catch { return null; }
}
function App() {
  const [booking, setBooking] = useState(readBooking);
  const [date, setDate] = useState(booking?.date || '');
  const [time, setTime] = useState(booking?.time || '');
  const [guests, setGuests] = useState(String(booking?.guests || 1));
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const dateInput = useRef(null);
  const confirmation = useRef(null);
  async function reserve(event) {
    event.preventDefault();
    if (lock.current) return;
    setMessage('');
    if (!validDate(date)) { setMessage('Please choose a valid date for your visit.'); dateInput.current?.focus(); return; }
    if (!TIMES.includes(time)) { setMessage('Please select a dinner time.'); return; }
    if (!Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > 6) { setMessage('Please enter a whole number of guests from 1 to 6.'); return; }
    lock.current = true;
    setPending(true);
    const requested = { date, time, guests: Number(guests) };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requested), signal: controller.signal });
      if (!response.ok) {
        setMessage(response.status === 409
          ? `This time is sold out (${date} at ${time}). Please choose another time or date.`
          : `Reservation service unavailable for ${date} at ${time}. Please try again. Your selections have been kept.`);
        return;
      }
      const result = await response.json();
      if (!result.id || !validBooking(result)) throw new Error('Invalid response');
      const saved = { ...requested, id: result.id };
      try { localStorage.setItem(KEY, JSON.stringify(saved)); }
      catch { setMessage('Your reservation is confirmed, but this browser could not save it. Please keep a copy of these details.'); }
      setBooking(saved);
      requestAnimationFrame(() => confirmation.current?.focus());
    } catch (error) {
      setMessage(error.name === 'AbortError' ? 'The request timed out. Please try again. Your selections have been kept.' : 'We could not confirm your reservation. Please check your connection and try again.');
    } finally { clearTimeout(timeout); lock.current = false; setPending(false); }
  }
  function edit() { setBooking(null); setMessage(''); requestAnimationFrame(() => dateInput.current?.focus()); }
  return <>
    <style>{styles}</style>
    <header><a className="brand" href="/" aria-label="Juniper home">juniper<span>KITCHEN & TABLE</span></a><span className="header-note">Good food. Better company.</span></header>
    <main>
      <section className="intro">
        <span className="eyebrow">A SEAT AT OUR TABLE</span>
        <h1>Make time<br />for something <em>good.</em></h1>
        <p>Seasonal plates, thoughtful ingredients, and evenings worth lingering over. We’ll save you a seat.</p>
        <div className="table-art" aria-hidden="true"><div className="napkin"/><div className="fork">Ⅲ<span>│</span></div><div className="plate"><div className="plate-inner">j.</div></div><div className="glass"/><div className="leaf leaf-one"/><div className="leaf leaf-two"/></div>
        <div className="visit-details"><div><span>DINNER, DAILY</span><p>17:00 – 21:30</p></div><div><span>COME AS YOU ARE</span><p>For tables of 1–6 guests</p></div></div>
      </section>
      <section className="booking-card" aria-label="Table reservation">
        <div className="card-top"><span className="eyebrow">YOUR EVENING STARTS HERE</span><span className="star" aria-hidden="true">✳</span></div>
        {booking ? <div data-testid="confirmation" tabIndex="-1" ref={confirmation} className="confirmation">
          <div className="success-mark" aria-hidden="true">✓</div><h2>You’re on the list.</h2><p className="description">Your table is confirmed. We look forward to welcoming you.</p>
          <dl><div><dt>Date</dt><dd>{new Date(`${booking.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}<small>{booking.date}</small></dd></div><div><dt>Time</dt><dd>{booking.time}</dd></div><div><dt>Guests</dt><dd>{booking.guests} {Number(booking.guests) === 1 ? 'guest' : 'guests'}</dd></div></dl>
          <button data-testid="edit" className="primary" onClick={edit}>Edit reservation <span aria-hidden="true">↗</span></button><p className="fine-print">Keep these details handy for your visit.</p>
        </div> : <>
          <h2>Reserve a table</h2><p className="description">A little planning. A lovely evening.</p>
          <form noValidate onSubmit={reserve} aria-busy={pending}>
            <fieldset disabled={pending}>
              <label htmlFor="date">Date <span>When shall we see you?</span></label>
              <input ref={dateInput} id="date" data-testid="date" type="date" required value={date} onChange={e => { setDate(e.target.value); setMessage(''); }} />
              <div className="form-row"><div><label htmlFor="time">Time</label><select id="time" data-testid="time" required value={time} onChange={e => { setTime(e.target.value); setMessage(''); }}><option value="">Select time</option>{TIMES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label htmlFor="guests">Guests</label><input id="guests" data-testid="guests" type="number" min="1" max="6" step="1" required value={guests} onChange={e => { setGuests(e.target.value); setMessage(''); }} /></div></div>
              <div className="reservation-note"><span aria-hidden="true">◷</span><p>Take your time. Your table is yours for the evening.</p></div>
              <button data-testid="submit" className="primary" type="submit">{pending ? 'Reserving your table…' : 'Reserve table'}<span aria-hidden="true">↗</span></button>
            </fieldset>
          </form><p className="fine-print">A warm welcome is always on the menu.</p>
        </>}
        <p id="reservation-message" data-testid="message" role="status" aria-live="polite" aria-atomic="true" className={message ? 'message' : 'message empty'}>{message}</p>
      </section>
    </main>
    <footer><span>juniper <span className="dot">·</span> Made for gathering.</span><span>Seasonal. Simple. Shared.</span></footer>
  </>;
}
const styles = `
*{box-sizing:border-box}body{margin:0;background:#f6f5ee;color:#273d33;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}button,input,select{font:inherit}a{color:inherit;text-decoration:none}header{max-width:1280px;margin:auto;padding:35px 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d9ddd3}.brand{font-family:Georgia,serif;font-size:38px;letter-spacing:-2px}.brand span{display:block;font:9px Arial,sans-serif;letter-spacing:2.6px;margin-top:4px}.header-note{font-size:12px;color:#6a7469}main{max-width:1184px;margin:65px auto 68px;display:grid;grid-template-columns:1.1fr 1fr;gap:100px;align-items:center;padding:0 24px}.eyebrow{font-size:10px;letter-spacing:2.2px;font-weight:700;color:#6f7966}h1{font:normal 64px/1.08 Georgia,serif;letter-spacing:-2.5px;margin:24px 0}h1 em{color:#7c8959;font-weight:normal}.intro>p{font-size:15px;line-height:1.85;max-width:395px;color:#6b7369}.table-art{height:200px;position:relative;margin:28px 0 25px;background:radial-gradient(ellipse at center,#e4e5d5 0,transparent 66%);overflow:hidden}.plate{position:absolute;width:180px;height:180px;border-radius:50%;left:50%;top:8px;transform:translateX(-50%);background:#eeeede;border:1px solid #d4d7c4;box-shadow:7px 10px 15px #34432e15,inset 0 0 0 9px #f8f7ee,inset 0 0 0 11px #d9dccb}.plate-inner{position:absolute;inset:30px;border:1px solid #daddcd;border-radius:50%;display:grid;place-items:center;box-shadow:inset 3px 3px 8px #8b95771a;font:italic 37px Georgia;color:#7c8959}.napkin{position:absolute;left:12%;top:30px;width:58px;height:150px;background:#bbc4a7;transform:rotate(-12deg);border:1px solid #a8b495;box-shadow:4px 5px 9px #273d3310}.fork{position:absolute;left:16%;top:50px;color:#617254;font:32px Georgia;transform:rotate(-12deg)}.fork span{display:block;line-height:0.6;text-align:center;font-size:65px}.glass{position:absolute;right:9%;top:10px;width:63px;height:63px;border:3px double #bdc6b1;border-radius:50%;background:#f8f8ed66;box-shadow:5px 5px 7px #273d330c}.leaf{position:absolute;background:#7d8d62;border-radius:90% 0 90% 0;width:65px;height:24px;right:8%;bottom:30px;transform:rotate(-25deg)}.leaf-two{right:14%;bottom:47px;transform:rotate(45deg);width:48px}.visit-details{display:flex;gap:50px;border-top:1px solid #d9ddd3;padding-top:23px}.visit-details span{font-size:9px;letter-spacing:1.5px;color:#6c745f}.visit-details p{font-size:13px;margin:10px 0 0}.booking-card{min-width:0;background:#fffef9;border:1px solid #e1e3d7;border-radius:5px;padding:34px 36px;box-shadow:0 12px 35px #33432a06}.card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.card-top .eyebrow{font-size:9px;letter-spacing:1.6px}.star{font-size:29px;color:#85916e}h2{font:normal 34px/1.15 Georgia,serif;letter-spacing:-.9px;margin:0 0 12px}.description{font-size:13px;color:#68725e;line-height:1.7;margin:0 0 31px}fieldset{border:0;padding:0;margin:0;min-width:0}label{display:block;font-size:12px;font-weight:600;margin-bottom:10px}label span{float:right;font-weight:400;color:#6c745f;font-size:10px}input,select{width:100%;min-width:0;height:50px;border:1px solid #d9dece;border-radius:3px;padding:0 13px;background:#fffef9;color:#334334;font-size:14px;color-scheme:light}input:focus,select:focus{outline:2px solid #80915b;outline-offset:2px}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:23px}.form-row>div{min-width:0}.reservation-note{display:flex;align-items:center;gap:11px;background:#f3f4ea;padding:12px 14px;margin:25px 0;color:#637151;border-radius:3px}.reservation-note>span{font-size:23px}.reservation-note p{font-size:11px;line-height:1.6;margin:0}.primary{width:100%;background:#344d3e;color:#fffef6;border:0;padding:17px 19px;border-radius:3px;text-align:left;font-size:13px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center}.primary:hover{background:#253c2e}.primary:focus-visible,a:focus-visible{outline:3px solid #99a678;outline-offset:4px}.primary span{font-size:19px}fieldset:disabled{opacity:.65}button:disabled{cursor:wait}.fine-print{text-align:center;color:#6c745f;font-size:10px;line-height:1.6;margin:17px 0 0}.message{margin:20px 0 0;padding:12px;background:#fff2df;border-left:3px solid #ad743b;color:#7b461f;font-size:13px;line-height:1.6;overflow-wrap:anywhere}.message.empty{margin:0;padding:0;border:0}.success-mark{width:43px;height:43px;background:#eaf0df;border-radius:50%;display:grid;place-items:center;margin-bottom:20px;color:#4b683d;font-size:23px}.confirmation:focus{outline:none}dl{margin:12px 0 30px}dl>div{padding:14px 0;border-bottom:1px solid #e5e7dc;display:flex;justify-content:space-between;gap:20px;font-size:13px}dt{color:#68725e}dd{margin:0;text-align:right;line-height:1.5}dd small{display:block;color:#68725e;margin-top:4px}footer{max-width:1184px;margin:auto;border-top:1px solid #d9ddd3;padding:25px 24px 30px;display:flex;justify-content:space-between;font-size:11px;color:#6c745f}.dot{margin:0 9px}
@media(min-width:1400px){main{margin-top:85px;margin-bottom:85px}}@media(max-width:900px){main{gap:35px}h1{font-size:50px}.booking-card{padding:28px 24px}.visit-details{gap:20px}}@media(max-width:650px){header{padding:23px 24px}.brand{font-size:32px}.header-note{font-size:10px;max-width:100px;text-align:right;line-height:1.6}main{display:flex;flex-direction:column;gap:30px;margin:35px auto;padding:0 22px}.intro{width:100%}h1{font-size:46px;letter-spacing:-1.8px;margin:18px 0}.intro>p{font-size:14px;margin-bottom:0}.table-art{height:150px;margin:16px 0}.plate{width:138px;height:138px}.plate-inner{inset:24px}.napkin{height:110px;top:20px}.fork{top:30px;font-size:23px}.fork span{font-size:49px}.glass{width:48px;height:48px}.visit-details{justify-content:space-between;padding-top:18px}.booking-card{width:100%;padding:25px 22px}.card-top{margin-bottom:22px}h2{font-size:31px}.description{margin-bottom:25px}.form-row{gap:13px}label span{font-size:9px}footer{margin:0 22px;padding:22px 0;gap:18px;font-size:10px}.card-top .eyebrow{font-size:8px}}
/* Allow content to wrap instead of clipping at narrow viewport widths. */
main{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}
.intro,.confirmation,dd{min-width:0;overflow-wrap:anywhere}
header,.card-top,.visit-details,footer{gap:16px;flex-wrap:wrap}
.form-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
input,select{max-width:100%}
@media(max-width:650px){input,select{font-size:16px}label{line-height:1.5}label span{float:none;display:block;margin-top:3px}.primary{min-height:52px}dd{max-width:75%}}
`;
createRoot(document.getElementById('root')).render(<App />);
