import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
// Initial checkpoint: selection controls only. Submission is deferred.
function App() {
  const [date, setDate] = useState(''); const [time, setTime] = useState(''); const [guests, setGuests] = useState('1');
  return <main><h1>Reserve a table</h1><form onSubmit={e => e.preventDefault()}>
    <label>Date <input data-testid="date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label>Time <select data-testid="time" value={time} onChange={e => setTime(e.target.value)}><option value="">Select time</option>{['17:00','18:00','19:00','20:00'].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
    <label>Guests <select data-testid="guests" value={guests} onChange={e => setGuests(e.target.value)}>{[1,2,3,4,5,6].map(count => <option key={count} value={String(count)}>{count}</option>)}</select></label>
    <button data-testid="submit" type="submit">Reserve</button><p data-testid="message" role="status"></p>
  </form></main>;
}
createRoot(document.getElementById('root')).render(<App />);

