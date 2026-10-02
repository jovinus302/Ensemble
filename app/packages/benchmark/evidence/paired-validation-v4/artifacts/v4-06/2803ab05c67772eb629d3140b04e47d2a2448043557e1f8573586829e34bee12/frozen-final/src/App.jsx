import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const TIMES = ['17:00', '18:00', '19:00', '20:00'];
const MIN_GUESTS = 1;
const MAX_GUESTS = 8;
const LARGE_PARTY = 7; // parties of this size or larger need a later slot
const EARLIEST_LARGE_PARTY_TIME = '18:00';
const STORAGE_KEY = 'restaurant-reservation';

// A party of 7-8 cannot take the 17:00 slot (anything before 18:00).
function timeAllowedForGuests(time, guestCount) {
  if (!Number.isFinite(guestCount)) return true;
  if (guestCount < LARGE_PARTY) return true;
  return time >= EARLIEST_LARGE_PARTY_TIME;
}

function loadBooking() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (b && b.date && b.time && b.guests) return b;
  } catch {
    /* ignore unreadable storage */
  }
  return null;
}

function saveBooking(booking) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(booking));
  } catch {
    /* storage may be unavailable; confirmation still shows in-session */
  }
}

function App() {
  const saved = loadBooking();
  const [date, setDate] = useState(saved ? saved.date : '');
  const [time, setTime] = useState(saved ? saved.time : '');
  const [guests, setGuests] = useState(saved ? String(saved.guests) : '2');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(saved);

  function handleGuestsChange(value) {
    setMessage('');
    setGuests(value);
    const count = parseInt(value, 10);
    // If the new party size makes the chosen time invalid, clear it + explain.
    if (time && !timeAllowedForGuests(time, count)) {
      setTime('');
      setMessage(
        `Parties of ${LARGE_PARTY} or more can only be seated from ${EARLIEST_LARGE_PARTY_TIME}. ` +
          `We cleared your ${time} selection — please choose ${EARLIEST_LARGE_PARTY_TIME} or later.`
      );
    }
  }

  function handleTimeChange(value) {
    setMessage('');
    const count = parseInt(guests, 10);
    if (value && !timeAllowedForGuests(value, count)) {
      setTime('');
      setMessage(
        `Parties of ${LARGE_PARTY} or more can only be seated from ${EARLIEST_LARGE_PARTY_TIME}. ` +
          `Please choose ${EARLIEST_LARGE_PARTY_TIME} or later.`
      );
      return;
    }
    setTime(value);
  }

  function handleDateChange(value) {
    setMessage('');
    setDate(value);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setMessage('');

    if (!date) {
      setMessage('Please choose a date.');
      return;
    }
    const count = Number(guests);
    if (guests === '' || !Number.isInteger(count) || count < MIN_GUESTS || count > MAX_GUESTS) {
      setMessage(`Please enter a party size between ${MIN_GUESTS} and ${MAX_GUESTS} guests.`);
      return;
    }
    if (!time) {
      setMessage('Please choose a time.');
      return;
    }
    if (!timeAllowedForGuests(time, count)) {
      setMessage(
        `Parties of ${LARGE_PARTY} or more can only be seated from ${EARLIEST_LARGE_PARTY_TIME}. ` +
          `Please choose ${EARLIEST_LARGE_PARTY_TIME} or later.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, time, guests: count }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (res.ok) {
        const booking = { id: data.id, date, time, guests: count };
        saveBooking(booking);
        setConfirmed(booking);
        setMessage('');
      } else {
        setMessage(
          data.error ||
            'Sorry, we could not complete your reservation. Please try again.'
        );
      }
    } catch {
      setMessage('We could not reach the reservation service. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    if (confirmed) {
      setDate(confirmed.date);
      setTime(confirmed.time);
      setGuests(String(confirmed.guests));
    }
    setMessage('');
    setConfirmed(null);
  }

  if (confirmed) {
    return (
      <main>
        <h1>You&rsquo;re booked</h1>
        <section className="confirmation-card" aria-live="polite">
          <p data-testid="confirmation">
            Reservation confirmed for {confirmed.guests}{' '}
            {confirmed.guests === 1 ? 'guest' : 'guests'} on {confirmed.date} at{' '}
            {confirmed.time}.
          </p>
          <button data-testid="edit" type="button" onClick={handleEdit}>
            Edit reservation
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <h1>Reserve a table</h1>
      <form onSubmit={handleSubmit} noValidate>
        <label>
          Date
          <input
            data-testid="date"
            type="date"
            value={date}
            onChange={e => handleDateChange(e.target.value)}
          />
        </label>
        <label>
          Time
          <select
            data-testid="time"
            value={time}
            onChange={e => handleTimeChange(e.target.value)}
          >
            <option value="">Select a time</option>
            {TIMES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Guests
          <input
            data-testid="guests"
            type="number"
            inputMode="numeric"
            min={MIN_GUESTS}
            max={MAX_GUESTS}
            step="1"
            value={guests}
            onChange={e => handleGuestsChange(e.target.value)}
          />
          <span className="hint">
            {MIN_GUESTS}&ndash;{MAX_GUESTS} guests. Parties of {LARGE_PARTY}+ seat from{' '}
            {EARLIEST_LARGE_PARTY_TIME}.
          </span>
        </label>
        <button data-testid="submit" type="submit" disabled={submitting}>
          {submitting ? 'Reserving…' : 'Reserve'}
        </button>
        <p data-testid="message" role="alert" aria-live="assertive">
          {message}
        </p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
