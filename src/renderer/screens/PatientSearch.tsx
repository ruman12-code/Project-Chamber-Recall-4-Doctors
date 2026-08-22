import { useCallback, useEffect, useRef, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { RegisterPatient } from './RegisterPatient';
import { MergePatients } from './MergePatients';
import type { PatientSearchResult } from '../../shared/patients';

/**
 * Finding a patient.
 *
 * The rule this screen is built around: it never chooses for you. Even
 * when exactly one person matches, that person is shown as a list of
 * one and somebody has to pick them. Attaching a visit to the wrong
 * record fuses two people's histories, and it does it silently.
 *
 * So there is no "best match", nothing is highlighted as more likely
 * than anything else, and pressing Enter opens whatever row the
 * assistant has actually moved to rather than a guess.
 */
export function PatientSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [active, setActive] = useState(0);
  const [pickedForMerge, setPickedForMerge] = useState<string[]>([]);
  const [mode, setMode] = useState<'search' | 'register' | 'merge'>('search');
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(async (text: string) => {
    if (text.trim() === '') { setResults([]); return; }
    const { value, failure } = unwrap(await api.patientSearch(text));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setResults(value!.results);
    setActive(0);
  }, []);

  useEffect(() => { void runSearch(query); }, [query, runSearch]);
  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  function togglePick(id: string) {
    setPickedForMerge((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length >= 2 ? current : [...current, id]);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Every laptop screen is fully keyboard-operable.
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === ' ' && event.ctrlKey && results[active] !== undefined) {
      event.preventDefault(); togglePick(results[active]!.id);
    } else if (event.key === 'Escape') { onClose(); }
  }

  if (mode === 'register') {
    return <RegisterPatient
      initialQuery={query}
      onDone={(id) => { setMode('search'); void runSearch(query); setPickedForMerge([]); void id; }}
      onCancel={() => setMode('search')} />;
  }

  if (mode === 'merge' && pickedForMerge.length === 2) {
    return <MergePatients
      firstId={pickedForMerge[0]!}
      secondId={pickedForMerge[1]!}
      onDone={() => { setMode('search'); setPickedForMerge([]); void runSearch(query); }}
      onCancel={() => setMode('search')} />;
  }

  return (
    <div className="patients">
      <div className="patients-head">
        <h1>Find a patient</h1>
        <span className="spacer" />
        {pickedForMerge.length === 2 && (
          <button onClick={() => setMode('merge')}>Compare these two</button>
        )}
        {pickedForMerge.length === 1 && (
          <span className="muted">Tick a second record to compare them</span>
        )}
        <button className="secondary" onClick={() => setMode('register')}>Register a new patient</button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      {failure !== null && <FailureNotice failure={failure} />}

      <div className="search-box">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Phone number or name — Bangla or English"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <p className="search-hint">
          Any part of a phone number or a name. A number written 01712-345678, +8801712345678 or
          just the last few digits all find the same patient.
          {results.length > 0 && <span className="search-count"> · {results.length} found</span>}
          {' '}Arrow keys move, Ctrl+Space ticks a record for merging.
        </p>
      </div>

      <div className="results">
        {query.trim() === '' ? (
          <div className="results-empty">Start typing to search.</div>
        ) : results.length === 0 ? (
          <div className="results-empty">
            <b>Nobody found</b>
            This search matches nothing. Check the spelling, try fewer letters or just the last few
            digits of the phone — or register this patient as new.
          </div>
        ) : results.map((result, index) => (
          <div
            key={result.id}
            className={`result ${index === active ? 'active' : ''} ${pickedForMerge.includes(result.id) ? 'picked' : ''}`}
            onClick={() => setActive(index)}
          >
            <input
              type="checkbox"
              checked={pickedForMerge.includes(result.id)}
              onChange={() => togglePick(result.id)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Tick to compare for merging"
            />
            <div>
              <div className="nm">
                {result.nameBn ?? result.nameEn}
                {result.nameBn !== null && result.nameEn !== null && <span className="alt">{result.nameEn}</span>}
              </div>
              {result.mergedIntoPatientId !== null && (
                <span className="merged-tag">merged into {result.mergedIntoName ?? 'another record'}</span>
              )}
            </div>
            <div className="cell">
              <b>{result.ageYears === null ? 'age not known' : `${result.ageYears}${result.ageIsApproximate ? ' approx' : ''}`}</b>
              <div className="dim">{result.sex ?? '—'}</div>
            </div>
            <div className="cell">{result.phone ?? <span className="dim">no phone</span>}</div>
            <div className="cell">
              <b>{result.visitCount}</b> <span className="dim">visit{result.visitCount === 1 ? '' : 's'}</span>
            </div>
            <div className="cell">
              {result.lastVisitDate === null
                ? <span className="dim">never seen</span>
                : <>{result.lastVisitDate}<div className="dim">{result.lastChamberName}</div></>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
