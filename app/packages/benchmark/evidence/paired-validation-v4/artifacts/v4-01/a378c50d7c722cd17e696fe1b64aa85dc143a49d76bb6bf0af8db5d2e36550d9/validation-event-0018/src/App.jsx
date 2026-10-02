import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const STORAGE_KEY = 'restaurant-reservation';
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validBooking(value) {
  return value && validDate(value.date) && TIMES.includes(value.time) && Number.isInteger(Number(value.guests)) && Number(value.guests) >= 1 && Number(value.guests) <= 6;
}
function loadBooking() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return validBooking(saved) ? saved : null;
  } catch { return null; }
}
function formatDate(date) {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
}
function App() {
  const [booking, setBooking] = useState(loadBooking);
  const [date, setDate] = useState(booking?.date || '');
  const [time, setTime] = useState(booking?.time || '');
  const [guests, setGuests] = useState(String(booking?.guests || 1));
  const [editing, setEditing] = useState(!booking);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  function change(setter, value) { setter(value); setMessage(''); }
  async function reserve(event) {
    event.preventDefault();
    if (pending.current) return;
    if (!validDate(date)) { setMessage('Please choose a valid reservation date.'); return; }
    if (!TIMES.includes(time)) { setMessage('Please select a dinner time.'); return; }
    if (!Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > 6) {
      setMessage('Please enter a whole number of guests from 1 to 6.'); return;
    }
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time, guests: Number(guests) }),
      });
      if (!response.ok) {
        setMessage(response.status === 409
          ? 'This time is sold out. Please choose another time or date.'
          : 'Reservation service unavailable. Please try again. Your selections are still here.');
        return;
      }
      const result = await response.json();
      if (!validBooking(result)) throw new Error('Invalid confirmation');
      setBooking(result);
      setEditing(false);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result)); }
      catch { setMessage('Your reservation is confirmed, but this browser could not save it. Keep these details before refreshing.'); }
    } catch {
      setMessage('We could not confirm your reservation. Please check your connection and try again.');
    } finally { pending.current = false; setBusy(false); }
  }
  return <>
    <style>{styles}</style>
    <div className="page">
      <header><a className="brand" href="/" aria-label="Olive and Ember home"><span className="brand-icon">✳</span> OLIVE & EMBER</a><span className="header-note">GOOD FOOD. GREAT COMPANY.</span></header>
      <main>
        <section className="intro">
          <div className="eyebrow"><span /> A PLACE AT OUR TABLE</div>
          <h1>A little time.<br />A lovely evening.</h1>
          <p className="intro-copy">Seasonal plates, warm conversation, and a table just for you. Make yourself an evening to look forward to.</p>
          <div className="table-art" aria-hidden="true"><div className="art-label">Gather around.</div><div className="napkin"/><div className="plate"><div className="plate-inner"><span>✳</span></div></div><div className="fork">│││<i /></div><div className="glass"/><div className="leaf leaf-one"/><div className="leaf leaf-two"/><div className="leaf leaf-three"/><span className="art-caption">FRESH SEASONS · SLOW EVENINGS</span></div>
          <div className="details"><span><b>Dinner, made memorable</b><small>Every evening · 5–9 pm</small></span><span><b>Come as you are</b><small>Tables for 1–6 guests</small></span></div>
        </section>
        <section className="reservation" aria-label="Table reservation">
          <div className="card-top"><span className="eyebrow">YOUR EVENING STARTS HERE</span><span className="step">{editing ? '01 / RESERVE' : '02 / CONFIRMED'}</span></div>
          {editing ? <>
            <h2>{booking ? 'Edit your reservation' : 'Reserve a table'}</h2>
            <p className="muted">Pick a date, bring your people. We’ll take care of the rest.</p>
            <form onSubmit={reserve} noValidate aria-busy={busy}>
              <fieldset disabled={busy}>
                <label htmlFor="date">Date <input id="date" data-testid="date" type="date" required value={date} onChange={e => change(setDate, e.target.value)} /></label>
                <div className="form-row">
                  <label htmlFor="time">Time <select id="time" data-testid="time" required value={time} onChange={e => change(setTime, e.target.value)}><option value="">Select time</option>{TIMES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
                  <label htmlFor="guests">Guests <input id="guests" data-testid="guests" type="number" min="1" max="6" step="1" required value={guests} onChange={e => change(setGuests, e.target.value)} /></label>
                </div>
                <p className="field-note">A seat for everyone, from 1 to 6 guests.</p>
                <button className="primary" data-testid="submit" type="submit">{busy ? 'Reserving your table…' : booking ? 'Save reservation' : 'Reserve table'}<span aria-hidden="true">↗</span></button>
              </fieldset>
            </form>
          </> : <div data-testid="confirmation" className="confirmation" role="status">
            <div className="check" aria-hidden="true">✓</div><h2>You’re on the list.</h2><p className="muted">Your table is confirmed. We look forward to welcoming you.</p>
            <dl><div><dt>Date</dt><dd>{formatDate(booking.date)}</dd></div><div><dt>Time</dt><dd>{booking.time}</dd></div><div><dt>Guests</dt><dd>{booking.guests} {Number(booking.guests) === 1 ? 'guest' : 'guests'}</dd></div></dl>
            <button className="primary" data-testid="edit" onClick={() => { setEditing(true); setMessage(''); }}>Edit reservation <span aria-hidden="true">↗</span></button>
          </div>}
          <p data-testid="message" className={message ? 'message visible' : 'message'} role="alert">{message}</p>
          <div className="card-footer"><span aria-hidden="true">◇</span><p>A good evening starts with a simple plan.<br /><b>We’ll have your table ready.</b></p></div>
        </section>
      </main>
      <footer><span>OLIVE & EMBER</span><span>Seasonal food. Lasting memories.</span><span>Stay a little longer.</span></footer>
    </div>
  </>;
}
const styles = `
*{box-sizing:border-box}body{margin:0;background:#f8f7f2;color:#283c32;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b88b46;outline-offset:4px}.page{max-width:1440px;margin:auto;padding:0 7%}header{height:112px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dedfd5;gap:20px}.brand{color:inherit;text-decoration:none;font-size:16px;letter-spacing:2px;font-weight:bold;display:flex;align-items:center;gap:12px}.brand-icon{font-size:34px;font-weight:normal}.header-note,.eyebrow,.step{font-size:10px;letter-spacing:1.8px;font-weight:bold}.header-note{color:#7d8277}main{display:grid;grid-template-columns:1.08fr 1fr;gap:10%;align-items:center;padding:69px 0 75px}.eyebrow{display:flex;align-items:center;gap:8px;color:#6a795f}.eyebrow>span{width:6px;height:6px;border-radius:50%;background:#81936f}h1{font-family:Georgia,serif;font-weight:normal;font-size:clamp(42px,4.2vw,62px);line-height:1.12;letter-spacing:-2px;margin:22px 0}p{line-height:1.7}.intro-copy{color:#757b71;font-size:14px;max-width:380px;margin-bottom:30px}.table-art{height:232px;background:#e8e8da;position:relative;overflow:hidden;border-radius:3px}.art-label{position:absolute;top:23px;left:22px;font-family:Georgia,serif;font-style:italic;font-size:23px;color:#69775c}.plate{width:207px;height:207px;background:#fbfaf1;border-radius:50%;position:absolute;top:40px;left:38%;box-shadow:4px 9px 16px #48533c25;display:grid;place-items:center;border:9px solid #f2f1e7}.plate-inner{border:1px solid #e0e1d3;border-radius:50%;width:153px;height:153px;display:grid;place-items:center}.plate-inner span{color:#7f8d61;font-size:64px}.napkin{position:absolute;width:127px;height:200px;left:28%;top:63px;background:#a7ad8c;transform:rotate(-18deg)}.fork{position:absolute;left:26%;top:90px;color:#9e9c7d;font-size:20px;letter-spacing:-5px}.fork i{display:block;width:3px;height:86px;background:#9e9c7d;margin-left:6px}.glass{position:absolute;width:69px;height:69px;right:18px;top:16px;border:4px double #fafbef;border-radius:50%;background:#f5f6e944;box-shadow:2px 4px 6px #283c3210}.leaf{position:absolute;border-radius:100% 0 100% 0;background:#667652;right:28px;bottom:29px;width:61px;height:23px;transform:rotate(-28deg)}.leaf-two{right:5px;bottom:64px;transform:rotate(-55deg)}.leaf-three{right:54px;bottom:6px;transform:rotate(-9deg)}.art-caption{position:absolute;bottom:15px;left:18px;letter-spacing:1.8px;font-size:8px;color:#59654c}.details{display:flex;gap:40px;margin-top:24px}.details b{font-size:11px;font-weight:600}.details small{display:block;color:#858a7e;font-size:11px;margin-top:8px}.reservation{background:#fffefa;border:1px solid #e4e5db;border-radius:8px;padding:33px;box-shadow:0 14px 40px #273e3205}.card-top{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:32px}.card-top .eyebrow{font-size:8px;letter-spacing:1.3px}.step{font-size:8px;letter-spacing:1px;color:#969b8b;white-space:nowrap}h2{font-family:Georgia,serif;font-weight:normal;font-size:32px;letter-spacing:-.8px;margin:0 0 12px}.muted{font-size:13px;color:#7a8074;margin:0 0 29px}fieldset{border:0;padding:0;margin:0;min-width:0}label{display:block;font-size:12px;font-weight:600;min-width:0}input,select{width:100%;min-width:0;height:49px;background:#fffefa;border:1px solid #dce0d3;border-radius:4px;padding:0 13px;color:#3b493d;margin-top:10px;font-size:13px}input[type=date]{display:block}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.field-note{font-size:10px;color:#8b9084;margin:12px 0 29px}.primary{border:0;background:#334b38;color:#fffef7;border-radius:4px;padding:17px 18px;width:100%;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-size:12px;font-weight:600}.primary:hover{background:#263e2b}.primary span{font-size:19px;line-height:14px}fieldset:disabled{opacity:.65}.primary:disabled{cursor:wait}.message{margin:0}.message.visible{margin-top:17px;padding:12px;background:#fff1e6;color:#884422;border:1px solid #ebc9b2;border-radius:4px;font-size:12px;overflow-wrap:anywhere}.card-footer{border-top:1px solid #e7e8df;margin-top:27px;padding-top:22px;display:flex;gap:13px;align-items:center}.card-footer>span{font-size:26px;color:#859070}.card-footer p{font-size:10px;color:#939889;margin:0;line-height:1.8}.card-footer b{font-weight:normal;color:#6b775f}footer{border-top:1px solid #dedfd5;padding:26px 0 30px;display:flex;justify-content:space-between;gap:20px;color:#949889;font-size:10px}footer span:first-child{font-size:9px;letter-spacing:1.6px;color:#66735f}.check{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;background:#e8edde;font-size:24px;margin-bottom:21px}dl{margin:20px 0 28px}dl>div{border-bottom:1px solid #e7e8df;padding:13px 0;display:flex;justify-content:space-between;gap:18px;font-size:12px}dt{color:#7a8074}dd{margin:0;text-align:right;line-height:1.5}
@media(max-width:760px){.page{padding:0 22px}header{height:84px}.brand{font-size:13px;letter-spacing:1.5px}.brand-icon{font-size:29px}.header-note{display:none}main{grid-template-columns:minmax(0,1fr);gap:34px;padding:37px 0 40px}h1{font-size:46px;margin:19px 0}.intro-copy{font-size:13px;margin-bottom:24px}.table-art{height:180px}.plate{width:177px;height:177px;top:30px;left:37%}.plate-inner{width:128px;height:128px}.art-label{font-size:19px;left:16px}.art-caption{font-size:7px}.details{gap:28px;margin-top:19px}.reservation{padding:24px 21px}.card-top{gap:8px;margin-bottom:25px}.card-top .eyebrow{font-size:7px}.step{font-size:7px}h2{font-size:29px}.form-row{gap:13px}footer{flex-wrap:wrap;gap:14px;font-size:9px}footer span:last-child{display:none}}
`;

createRoot(document.getElementById('root')).render(<App />);
