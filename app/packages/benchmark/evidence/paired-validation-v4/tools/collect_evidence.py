"""Incremental v4-only evidence curator. No providers, subprocesses, or raw writes.

Usage: python collect_evidence.py --run-root RAW_V4 --output CURATED
For relocated raw snapshots add --recorded-run-root ORIGINAL_RAW_V4_PATH.
Python 3.9+, standard library only.
Run after each cell. Reports can be preliminary while teardown is still running;
missing reports mean no_report_yet, not proof that a cell was never started.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import pathlib
import re

WORKSPACE = pathlib.Path.cwd()
OUTPUT_ROOT = None
REDACTION_ROOTS = []
IDS = [f'v4-{n:02}' for n in range(1, 9)]
FIELDS = ('schemaVersion protocolRevision mode cell blindId baseSha rubricHash starterHash model effort cacheState '
          'status error preparationMs taskMs totalMs checkpointMs changeMs afterChangeMs checks calls usage costUsd '
          'underlyingApiCalls actualModelInvocations humanInterventions humanRequests').split()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(file):
    data = file.read_bytes()
    value = json.loads(data.decode('utf-8-sig'))
    if file.read_bytes() != data:
        raise ValueError('Report changed during read; collect again after this cell finishes')
    return value, data


def inside(file, root):
    return file.resolve().is_relative_to(root.resolve())


def clean(value):
    if isinstance(value, str):
        for folder, label in REDACTION_ROOTS + [(pathlib.Path.home(), '[USERPROFILE]')]:
            for spelling in {str(folder), str(folder).replace('\\', '/')}:
                value = re.sub(re.escape(spelling), lambda _: label, value, flags=re.I)
        value = re.sub(r'(?i)[A-Z]:[\\/]Users[\\/][^\\/\s]+', '[USERPROFILE]', value)
        return re.sub(r'(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]', value)
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if re.fullmatch(r'(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)', key):
                result[key] = '[REDACTED]'
            elif key in ('content', 'contentBase64') and isinstance(item, str):
                result[key] = {'omittedFromLedger': True, 'utf8Bytes': len(item.encode()), 'sha256': sha(item.encode())}
            else:
                result[key] = clean(item)
        return result
    return value


def save_json(file, value):
    if OUTPUT_ROOT is None or not inside(file, OUTPUT_ROOT):
        raise ValueError('Output path escapes the explicit output root')
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, file)


def copy_sources(source, target, run):
    """Copy exact source bytes, retaining exceptions/comments; never traverse links."""
    if not source.is_dir() or not inside(source, run):
        return {}
    candidates = []
    if (source / 'src').is_dir() and inside(source / 'src', source):
        for folder, directories, names in os.walk(source / 'src', followlinks=False):
            directories[:] = [name for name in directories if not (pathlib.Path(folder) / name).is_symlink()
                              and inside(pathlib.Path(folder) / name, source)]
            candidates.extend(pathlib.Path(folder) / name for name in names)
    candidates += [source / name for name in ('index.html', 'package.json', 'build.mjs', 'server.mjs')]
    hashes = {}
    for file in sorted(candidates):
        if not file.is_file() or file.is_symlink() or not inside(file, source):
            continue
        relative = file.relative_to(source)
        if relative.parts[0] == 'src' and file.suffix.lower() not in ('.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.svg'):
            continue
        data = file.read_bytes()
        destination = target / relative
        if not inside(destination, OUTPUT_ROOT):
            raise ValueError('Artifact destination escapes output root')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        hashes[relative.as_posix()] = sha(data)
    return hashes


def limitations(value, location='events'):
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            here = f'{location}.{key}'
            if 'limitation' in key.lower():
                found.append({'location': here, 'value': clean(child)})
            elif isinstance(child, (dict, list)):
                found.extend(limitations(child, here))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(limitations(child, f'{location}[{index}]'))
    return found


def map_snapshot(recorded, run, cell_id, recorded_run_root=None):
    """Only exact validation/<this-cell>/<sequence-hash> snapshot roots may relocate."""
    normalized = recorded.replace('\\', '/').rstrip('/')
    prefixes = [str(run).replace('\\', '/').rstrip('/')]
    if recorded_run_root:
        prefixes.append(str(recorded_run_root).replace('\\', '/').rstrip('/'))
    relative = normalized
    for prefix in prefixes:
        if normalized.lower().startswith(prefix.lower() + '/'):
            relative = normalized[len(prefix) + 1:]
            break
    parts = relative.split('/')
    if len(parts) != 3 or parts[:2] != ['validation', cell_id] or not re.fullmatch(r'\d+-[a-f0-9]{64}', parts[2]):
        return None
    mapped = run.joinpath(*parts)
    return mapped if inside(mapped, run / 'validation' / cell_id) else None


def collect(run, out, recorded_run_root=None):
    global OUTPUT_ROOT, REDACTION_ROOTS
    run, out = pathlib.Path(run).resolve(), pathlib.Path(out).resolve()
    if inside(out, run) or inside(run, out):
        raise ValueError('Raw and curated roots must be disjoint; never write inside raw inputs')
    OUTPUT_ROOT = out
    REDACTION_ROOTS = [(run, '[RUN]'), (out, '[CURATED]')]
    if recorded_run_root:
        REDACTION_ROOTS.insert(0, (recorded_run_root, '[RUN]'))
    # Do not mkdir/run/open sessions: the live launcher requires an absent root.
    if not run.exists():
        return {'kind': 'v4-evidence-collection', 'collectorModelCalls': 0, 'runExists': False,
                'availableReportCount': 0, 'noReportYet': IDS, 'liveRootCreated': False}
    rows, warnings = [], []
    for cell_id in IDS:
        file = run / 'reports' / f'{cell_id}.json'
        if not file.exists():
            continue
        if file.is_symlink() or not inside(file, run):
            warnings.append({'cell': cell_id, 'detail': 'Report path escapes run root or is a link'})
            continue
        try:
            report, raw = read_json(file)
            if report.get('protocolRevision') != 'paired-validation-v4' or report.get('mode') != 'live' or report.get('cell', {}).get('id') != cell_id:
                raise ValueError('Wrong protocol/mode/cell: excluded rather than mixed with v4')
        except (OSError, ValueError) as error:
            warnings.append({'cell': cell_id, 'detail': clean(str(error))})
            continue
        report_hash = sha(raw)
        events = report.get('events', [])
        version_root = out / 'reports' / cell_id
        # Preserve every observed report version, including failed/preliminary versions.
        save_json(version_root / f'{report_hash}.json', clean(report))
        sequence = []
        for index, event in enumerate(events):
            if not isinstance(event, dict):
                continue
            if event.get('type') == 'native_ledger':
                for ledger_index, entry in enumerate(event.get('events', [])):
                    sequence.append({'reportEventIndex': index, 'ledgerIndex': ledger_index, 'event': clean(entry)})
            else:
                sequence.append({'reportEventIndex': index, 'event': clean(event)})
        ledger_file = out / 'ledgers' / cell_id / f'{report_hash}.json'
        save_json(ledger_file, {'ordering': 'Report event order; native ledger nested order retained, not an inferred global wallclock order', 'sequence': sequence})
        row = {key: report.get(key) for key in FIELDS}
        calls = report.get('calls', [])
        row.update(rawReportSha256=report_hash, rawReportPath=f'reports/{cell_id}.json',
                   curatedReportPath=(version_root / f'{report_hash}.json').relative_to(out).as_posix(),
                   ledgerPath=ledger_file.relative_to(out).as_posix(), topLevelAttempts=len(calls),
                   attemptsByRole=dict(collections.Counter(call.get('role', 'unknown') for call in calls)),
                   browserPassed=sum(check.get('pass') is True for check in report.get('checks', [])),
                   browserTotal=len(report.get('checks', [])),
                   initialMs=report.get('checkpointMs') if report['cell'].get('task') == 'B' else None,
                   initialImplementationMs=(report['checkpointMs'] - report.get('preparationMs', 0))
                   if report['cell'].get('task') == 'B' and report.get('checkpointMs') is not None else None,
                   fullWorkerDurations=[e for e in events if e.get('type') in ('native_worker_duration', 'direct_worker_duration')],
                   partialPmJudgeUsage=[e for e in events if e.get('type') == 'native_usage'],
                   cleanupEvents=[e for e in events if e.get('type') in ('cleanup-error', 'artifact-error', 'artifact-unstable')],
                   checkpointEvents=[e for e in events if e.get('type') == 'checkpoint'],
                   limitations=limitations(events),
                   directReplies=[clean(e.get('text', '')) for e in events if e.get('type') == 'direct_reply'],
                   reportWriteTimeUtc=dt.datetime.fromtimestamp(file.stat().st_mtime, dt.timezone.utc).isoformat(),
                   finalizationCaveat='Report may be a teardown-time preliminary write. Collect after the cell completes; preserve all observed versions. File mtime is not a model stop time.')
        source_roots = []
        blind_id = report.get('blindId', '')
        if re.fullmatch(r'[a-fA-F0-9-]{36}', blind_id):
            blind = run / 'blind' / blind_id
            if (blind / 'REVIEW.json').is_file():
                source_roots.append(('frozen-final', blind))
        for index, event in enumerate(events):
            if event.get('type') == 'trusted-validation-start' and isinstance(event.get('snapshot'), str):
                source = map_snapshot(event['snapshot'], run, cell_id, recorded_run_root)
                if source is not None:
                    source_roots.append((f'validation-event-{index:04}', source))
                else:
                    warnings.append({'cell': cell_id, 'detail': f'Snapshot mapping rejected at report event {index}; supply an exact recorded run root for relocation'})
        row['artifacts'], row['screenshots'] = [], []
        screenshot_roots = [(phase, run / 'evidence' / cell_id / phase) for phase in ('checkpoint', 'final')]
        for label, source in source_roots:
            target = out / 'artifacts' / cell_id / report_hash / label
            hashes = copy_sources(source, target, run)
            if hashes:
                row['artifacts'].append({'kind': label, 'path': target.relative_to(out).as_posix(), 'sourceSha256': hashes,
                                         'note': 'Exact captured source bytes; exceptions/comments are not filtered. Not a claim of successful acceptance.'})
            screenshot_roots.append((label, source / 'browser-evidence'))
        for label, folder in screenshot_roots:
            if not inside(folder, run):
                continue
            for source in sorted(folder.glob('*.png')):
                if source.is_symlink() or not inside(source, run):
                    continue
                data = source.read_bytes()
                target = out / 'screenshots' / cell_id / report_hash / label / source.name
                if not inside(target, out):
                    raise ValueError('Screenshot destination escapes output root')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                row['screenshots'].append({'path': target.relative_to(out).as_posix(), 'sha256': sha(data)})
        row['artifactAvailability'] = 'captured' if row['artifacts'] else 'not_available_no_mutable_worker_fallback'
        rows.append(clean(row))
    missing = [cell_id for cell_id in IDS if not any(row['cell']['id'] == cell_id for row in rows)]
    payload = {'kind': 'v4-evidence-collection', 'protocolRevision': 'paired-validation-v4', 'mode': 'live-reports',
               'collectorModelCalls': 0, 'generatedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(),
               'plannedCells': 8, 'availableReportCount': len(rows), 'allEightReportsAvailable': len(rows) == 8,
               'noReportYet': missing, 'remainingWithoutReport': len(missing), 'warnings': warnings,
               'partial': bool(missing), 'fixtureResultsExcluded': True, 'legacyResultsExcluded': True,
               'interpretation': 'Exploratory within-provider paired observations only. Partial reports are not a completed eight-cell result; no superiority or significance claim. Missing report does not prove unstarted.',
               'metricDefinitions': {'initialMs': 'B checkpointMs: elapsed from run start, including preparation',
                   'initialImplementationMs': 'B checkpointMs minus preparationMs', 'afterChangeMs': 'Includes final validation and cleanup after change injection',
                   'taskMs': 'totalMs minus preparationMs', 'totalMs': 'Includes preparation, PM, worker, judge, host validation and cleanup',
                   'workerCallRows': 'Submission latency; use fullWorkerDurations for full worker wall time',
                   'costAndApiCalls': 'Unknown totals remain null; partial native_usage is not complete worker cost'},
               'reports': rows}
    save_json(out / 'results.json', payload)
    return payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-root', type=pathlib.Path, help='Only the raw paired-validation-v4 directory')
    parser.add_argument('--output', type=pathlib.Path, help='Separate curated evidence directory, disjoint from raw input')
    parser.add_argument('--recorded-run-root', help='Exact original raw run-root prefix when relocating recorded absolute snapshot paths')
    args = parser.parse_args()
    if args.run_root is None or args.output is None:
        parser.error('--run-root and --output are required; no default live path is created')
    result = collect(args.run_root, args.output, args.recorded_run_root)
    print(json.dumps({key: result.get(key) for key in
        ('kind', 'collectorModelCalls', 'availableReportCount', 'remainingWithoutReport', 'noReportYet', 'allEightReportsAvailable', 'warnings')}, ensure_ascii=False, indent=2))
