// Deliberate implementation defects for real-browser negative controls, never model evidence.
export function oracleVariant(source, variant) {
  const replace = (from, to) => { if (!source.includes(from)) throw new Error(`Fixture mutation anchor missing: ${variant}`); source = source.replace(from, to); };
  if (variant === 'localized') replace('{saved.date}', "{new Date(saved.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}");
  if (variant === 'wrong-date') replace('{saved.date}', "{'2030-06-19'}");
  if (variant === 'wrong-time') replace('{saved.time}', "{'18:00'}");
  if (variant === 'wrong-guests') replace('{saved.guests}', '{5}');
  if (variant === 'wrong-persisted') replace("localStorage.setItem('booking', JSON.stringify(data))", "localStorage.setItem('booking', JSON.stringify({ ...data, date: '2030-06-19' }))");
  if (variant === 'wrong-restored-controls') replace("useState(saved?.date || '')", "useState(saved ? '2030-06-19' : '')");
  if (variant === 'wrong-api-payload') replace('JSON.stringify({ date, time, guests: Number(guests) })', "JSON.stringify({ date: '2030-06-19', time, guests: Number(guests) })");
  if (variant === 'hardcoded-first-tuple') { replace('{saved.date}', "{'2030-06-17'}"); replace('{saved.time}', "{'19:00'}"); replace('{saved.guests}', '{6}'); }
  if (variant === 'broken-B') replace("setTime(''); setMessage('Time cleared:", "setMessage('Time cleared:");
  if (variant === 'external-http') source += "\nfetch('https://example.invalid/forbidden').catch(() => {});\n";
  if (variant === 'external-websocket') source += "\nnew WebSocket('wss://example.invalid/forbidden');\n";
  if (variant === 'session-storage') source = source.replaceAll('localStorage', 'sessionStorage');
  if (variant === 'A-no-edit') replace('<button data-testid="edit" onClick={() => setConfirmed(false)}>Edit reservation</button>', '');
  return source;
}
