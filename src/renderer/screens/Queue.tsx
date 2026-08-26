import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { PatientSearch } from './PatientSearch';
import type { QueueEntry, QueueView } from '../../shared/queue';
import type { SerialClashView } from '../../shared/ipc';

/**
 * The serial register and the live queue.
 *
 * This replaces a paper book, and it has to beat the book at the book's
 * own job before anything else in this software matters. So the serial
 * number is the largest thing on every row - it is what gets called out
 * across a waiting room - and adding an arrival is two taps from here.
 *
 * It works entirely on its own. Nobody has to answer a single intake
 * question for this screen to be worth using, and a patient with no
 * intake is shown plainly as not screened rather than silently looking
 * the same as somebody the questions cleared.
 *
 * Reordering is by buttons and by keyboard rather than by dragging.
 * Dragging on a touch screen misfires, and a misfire here silently
 * changes who the doctor sees next.
 */
export function Queue(
  { onClose, onOpenCard, onRecord, embedded = false, onSessionOver, onChangeChamber }: {
    /**
     * Absent when this list IS the home screen rather than a screen
     * opened on top of it. There is nothing to close back to, so no
     * Close button is drawn.
     */
    onClose?: () => void;
    onOpenCard?: (visitId: string) => void;
    onRecord?: (visitId: string) => void;
    /**
     * On its own, this list fills the window. On the home screen it has
     * to flow in the page with panels underneath it, so it lets go of
     * the viewport and bounds its own scrolling instead.
     */
    embedded?: boolean;
    /**
     * Everybody who came has been seen. Offered rather than taken: the
     * doctor decides when the evening is over, not a count reaching
     * zero. Somebody may still walk in.
     */
    onSessionOver?: () => void;
    /**
     * Which chamber this list belongs to is decided once, on the way in,
     * and it is not decided again here. This list used to carry its own
     * chamber picker, which meant two controls for one fact: switching
     * with the picker left the name in the strip above still saying the
     * old chamber. Now the chamber is stated, not offered, and the one
     * way back to the choice is this -- passed only where the strip
     * carrying it is not on screen.
     */
    onChangeChamber?: () => void;
  },
) {
  const [view, setView] = useState<QueueView | null>(null);
  const [clashes, setClashes] = useState<SerialClashView[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(0);
  const [justAdded, setJustAdded] = useState<{ serialNo: number; name: string } | null>(null);

  const refresh = useCallback(async () => {
    const { value, failure } = unwrap(await api.queueToday());
    if (failure) { setFailure(failure); return; }
    setView(value!.view);
    // Anybody who was told one number and given another. Read with the
    // list, so a tablet's arrivals landing while this screen is open
    // raise the warning without anybody reopening anything.
    const told = unwrap(await api.serialClashes());
    if (told.value) setClashes(told.value.clashes);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Waiting times are the point of a live queue, so they keep counting
  // without anybody touching the screen.
  useEffect(() => {
    const timer = setInterval(() => { void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function act<T extends object>(promise: Promise<import('../../shared/ipc').Result<T>>) {
    const { failure } = unwrap(await promise);
    if (failure) { setFailure(failure); return false; }
    setFailure(null);
    await refresh();
    return true;
  }

  async function addPatient(patientId: string) {
    const { value, failure } = unwrap(await api.queueRegisterArrival(patientId, false));
    if (failure) { setFailure(failure); setAdding(false); return; }
    if (value!.alreadyOnListVisitId !== null) {
      const confirmed = window.confirm(
        'This patient is already on today\'s list.\n\nAdd them a second time anyway? Only do this if they really have come back a second time this evening.',
      );
      if (!confirmed) { setAdding(false); await refresh(); return; }
      const second = unwrap(await api.queueRegisterArrival(patientId, true));
      if (second.failure) { setFailure(second.failure); setAdding(false); return; }
      setJustAdded({ serialNo: second.value!.serialNo, name: '' });
    } else {
      setJustAdded({ serialNo: value!.serialNo, name: '' });
    }
    setAdding(false);
    await refresh();
  }

  if (adding) {
    return <PatientSearch
      onClose={() => setAdding(false)}
      onPick={(patient) => { void addPatient(patient.id); }}
      pickLabel="Give a serial" />;
  }

  // The failure check comes BEFORE the loading check, always. With them
  // the other way round - which is how this was first written - an error
  // on the very first load leaves the screen saying "Reading today's
  // list" for ever with the error rendered nowhere, which is the exact
  // silent failure this project treats as the worst possible outcome.
  if (failure !== null && view === null) {
    return <div className="page"><FailureNotice failure={failure} /></div>;
  }
  if (view === null) return <div className="page"><p className="muted">Reading today's list…</p></div>;

  const entries = view.entries;
  const count = (status: QueueEntry['status']) => entries.filter((e) => e.status === status).length;
  const reportsOnly = entries.filter(
    (e) => e.visitKind === 'reports_only' && (e.status === 'waiting' || e.status === 'in_chamber'),
  ).length;
  const waitingIds = entries.filter((e) => e.status === 'waiting').map((e) => e.visitId);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((i) => Math.min(i + 1, entries.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); }
    else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey) { /* handled below */ }
    // Escape closes the list only when there is something behind it.
    else if (event.key === 'Escape') { onClose?.(); }
  }

  function onKeyDownCapture(event: React.KeyboardEvent) {
    // Keys are for the list, not for whatever control happens to have
    // focus. Without this, pressing "c" while the chamber picker is
    // focused would open a card instead of choosing a chamber.
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    const entry = entries[selected];
    if (entry === undefined) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      void act(api.queueMove(entry.visitId, event.key === 'ArrowUp' ? 'up' : 'down'));
    } else if (event.key === 'Enter' && entry.status === 'waiting') {
      event.preventDefault();
      void act(api.queueSetStatus(entry.visitId, 'in_chamber'));
    } else if (event.key.toLowerCase() === 'c' && onOpenCard !== undefined) {
      event.preventDefault();
      onOpenCard(entry.visitId);
    }
  }

  // Who the desk is calling for, and who it has already called without
  // an answer. Both come from the data layer; neither reorders anything.
  const upNext = entries.find((e) => e.visitId === view.upNextVisitId);
  const passedOver = entries.filter(
    (e) => e.status === 'waiting' && e.calledNoAnswer > 0 && e.visitId !== view.upNextVisitId,
  );

  return (
    <div className={embedded ? 'queue embedded' : 'queue'} tabIndex={0}
      onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture}>
      {/* The heading for paper. On screen the chamber is named beside
          the title; on paper it has to say which chamber and which day,
          at the top, because the sheet outlives the screen. */}
      <div className="print-only print-head">
        {view.chamberName} — {view.visitDate}
      </div>

      <div className="queue-head">
        <h1>Today's list</h1>
        <span className="qchamber">{view.chamberName}</span>
        {onChangeChamber !== undefined && (
          <button className="secondary quiet" onClick={onChangeChamber}>Change chamber</button>
        )}
        <span className="muted">{view.visitDate}</span>

        <div className="queue-counts">
          <div className="c"><b>{count('waiting')}</b>waiting</div>
          <div className="c"><b>{count('in_chamber')}</b>with the doctor</div>
          <div className="c"><b>{count('done')}</b>seen</div>
          {/* Counted, and shown, and that is all. The order of the list
              is untouched: these patients sit where they arrived, until
              a doctor says otherwise. */}
          {reportsOnly > 0 && (
            <div className="c reports"><b>{reportsOnly}</b>reports only</div>
          )}
        </div>

        <span className="spacer" />
        <button onClick={() => { setJustAdded(null); setAdding(true); }}>Patient has arrived</button>
        <button className="secondary" onClick={() => window.print()}>Print this list</button>
        {onClose !== undefined && <button className="secondary" onClick={onClose}>Close</button>}
      </div>

      {/* Nobody is waiting and nobody is with the doctor. Offered, not
          taken: the doctor decides when an evening is over, and
          somebody may still walk through the door.

          The sentence says what actually happened rather than one
          cheerful line for every ending. An evening where four people
          gave up and went home before they were called is not an
          evening where everybody was seen, and it must not read like
          one -- that is the ending the doctor most needs to notice. */}
      {onSessionOver !== undefined && entries.length > 0
        && count('waiting') === 0 && count('in_chamber') === 0 && (
        <div className={count('done') === 0 ? 'session-over none-seen' : 'session-over'}>
          <b>
            {count('done') === 0
              ? `Nobody is waiting in ${view.chamberName}.`
              : count('left') === 0
                ? `Everybody who came has been seen in ${view.chamberName}.`
                : `Everybody still here has been seen in ${view.chamberName}.`}
          </b>{' '}
          {count('done') > 0 && `${count('done')} seen`}
          {count('done') > 0 && count('left') > 0 && ', '}
          {count('left') > 0
            && `${count('left')} left without being seen`}
          {(count('done') > 0 || count('left') > 0) && '.'}
          <button onClick={onSessionOver}>Finish here and choose a chamber</button>
        </div>
      )}

      {/* Who is actually walking in next.
          Not the first person on the list -- that stops being true the
          moment the desk calls a number and nobody stands up. The desk
          moves on; without this the doctor sits waiting for serial 1
          while serial 2 is coming through the door.
          Read from the same rule the tablet uses (upNext.ts), so the
          two screens cannot say different things. */}
      {upNext !== undefined && (
        <div className="up-next">
          {/* While somebody is in the room this is who follows them, and
              it must not read as though it were the patient in front of
              him. Two words, and the ambiguity is gone. */}
          <span className="lbl">{count('in_chamber') > 0 ? 'After this one' : 'Next in'}</span>
          <span className="sn">{upNext.serialNo}</span>
          <span className="nm">{upNext.nameBn ?? upNext.nameEn ?? ''}</span>
          {upNext.calledNoAnswer > 0 && (
            <span className="why">
              the desk has called this number {upNext.calledNoAnswer}× already
            </span>
          )}
          {passedOver.length > 0 && (
            <span className="why">
              {passedOver.map((e) => e.serialNo).join(', ')}{' '}
              {passedOver.length === 1 ? 'was' : 'were'} called and did not come —{' '}
              still waiting, still on this list
            </span>
          )}
        </div>
      )}

      {justAdded !== null && (
        <div className="banner" style={{ marginBottom: 0 }}>
          Serial {justAdded.serialNo} given. Tell the patient their number.
        </div>
      )}

      {/* Somebody was told one number at the desk and has been given
          another, because this laptop had used it while the tablet was
          away. They kept their place; they do not know their number
          changed. A person has to tell them. */}
      {clashes.map((clash) => (
        <div className="clash" key={clash.visitId}>
          <b>{clash.nameBn ?? clash.nameEn}</b> was told <b>serial {clash.serialAnnounced}</b> at the
          desk, and that number was already used here. They are now <b>serial {clash.serialNo}</b> and
          have kept their place in the order. <b>Tell them their new number.</b>
          <button onClick={() => {
            void (async () => {
              const { failure } = unwrap(await api.serialClashSeen(clash.visitId));
              if (failure) { setFailure(failure); return; }
              setClashes((all) => all.filter((c) => c.visitId !== clash.visitId));
            })();
          }}>I have told them</button>
        </div>
      ))}

      {failure !== null && <FailureNotice failure={failure} />}

      <div className="queue-list">
        {entries.length === 0 ? (
          <div className="queue-empty">
            <b>Nobody on the list yet</b>
            Tap "Patient has arrived" when the first patient comes in.
          </div>
        ) : entries.map((entry, index) => (
          <Row
            key={entry.visitId}
            entry={entry}
            selected={index === selected}
            canMoveUp={waitingIds.indexOf(entry.visitId) > 0}
            canMoveDown={waitingIds.indexOf(entry.visitId) >= 0 && waitingIds.indexOf(entry.visitId) < waitingIds.length - 1}
            onSelect={() => setSelected(index)}
            onOpenCard={onOpenCard === undefined ? undefined : () => onOpenCard(entry.visitId)}
            onRecord={onRecord === undefined ? undefined : () => onRecord(entry.visitId)}
            onMove={(direction) => { void act(api.queueMove(entry.visitId, direction)); }}
            onStatus={(status) => {
          // A patient the questions flagged cannot be taken off the
          // list by one careless tap. The software cannot stop somebody
          // walking out, but it can make sure nobody does it by
          // accident, and it records that it happened either way.
          if (status === 'left' && entry.redFlags.length > 0) {
            const sure = window.confirm(
              'This patient was flagged to be seen sooner.\n\nMark them as having left without seeing the doctor?\n\nOnly do this if they have actually gone. It will be recorded.',
            );
            if (!sure) return;
          }
          void act(api.queueSetStatus(entry.visitId, status));
        }}
          />
        ))}
      </div>

      <p className="queue-foot no-print">
        Arrow keys move down the list · Alt and an arrow moves a patient up or down the order ·
        Enter calls the highlighted patient in
        {onOpenCard !== undefined && " · C opens the highlighted patient's card"}.
        Serial numbers never change when the order does.
      </p>
    </div>
  );
}

function Row(
  { entry, selected, canMoveUp, canMoveDown, onSelect, onOpenCard, onRecord, onMove, onStatus }: {
    entry: QueueEntry; selected: boolean; canMoveUp: boolean; canMoveDown: boolean;
    onSelect: () => void; onOpenCard?: () => void; onRecord?: () => void;
    onMove: (d: 'up' | 'down') => void; onStatus: (s: QueueEntry['status']) => void;
  },
) {
  const flagged = entry.redFlags.length > 0;
  const name = entry.nameBn ?? entry.nameEn ?? 'unnamed';
  const altName = entry.nameBn !== null && entry.nameEn !== null ? entry.nameEn : null;

  return (
    <div
      className={`qrow ${entry.status} ${flagged ? 'flagged' : ''} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="serial"><small>serial</small>{entry.serialNo}</div>

      <div className="who">
        <div className="n">{name}{altName !== null && <span className="alt">{altName}</span>}</div>
        <div className="tags">
          {flagged && <span className="qtag flag">SEE SOONER</span>}
          {/* Here to show a test the doctor asked for. "Not screened"
              would be wrong for them and would read as something
              missing, so it is not shown. */}
          {entry.visitKind === 'reports_only'
            ? <span className="qtag reports">reports only</span>
            : <>
              {!entry.intakeStarted && <span className="qtag gap">not screened</span>}
              {entry.intakeStarted && entry.screeningIncomplete && <span className="qtag gap">screening incomplete</span>}
            </>}
          {/* The desk called this number out and nobody stood up.
              Nothing about the visit changed for it -- they are still
              waiting, still in the same place -- and this is here
              because deciding what to do about it is the doctor's, not
              the tablet's. */}
          {entry.calledNoAnswer > 0 && entry.status === 'waiting' && (
            <span className="qtag noanswer">
              called {entry.calledNoAnswer}×, no answer
            </span>
          )}
          {/* "First visit" is a clinical statement: it says there is no
              history to look for. Against somebody the doctor has been
              treating since 2019 it is false, and stays false for weeks
              until they accumulate visits here. So it is only printed
              for somebody who really is new. */}
          {entry.previousVisits === 0
            ? (entry.attendingSince === null
              ? <span className="qtag new">first visit</span>
              : <span className="qtag since">coming since {entry.attendingSince} · first on this system</span>)
            : <span className="qtag back">{entry.previousVisits} previous · last {entry.lastVisitDate}</span>}
        </div>
      </div>

      <div className="cell">
        {entry.ageYears === null ? <span className="muted">age not known</span>
          : `${entry.ageYears}${entry.ageIsApproximate ? ' approx' : ''}`}
        <div className="muted">{entry.sex ?? '—'}</div>
      </div>

      <div className={`waited ${entry.waitedMinutes >= 45 && entry.status === 'waiting' ? 'long' : ''}`}>
        {entry.waitedMinutes}<small>{entry.status === 'waiting' ? 'min waiting' : 'min waited'}</small>
      </div>

      <div className="nudge no-print">
        {entry.status === 'waiting' && (
          <>
            <button className="secondary" disabled={!canMoveUp} onClick={(e) => { e.stopPropagation(); onMove('up'); }} aria-label="Move up">▲</button>
            <button className="secondary" disabled={!canMoveDown} onClick={(e) => { e.stopPropagation(); onMove('down'); }} aria-label="Move down">▼</button>
          </>
        )}
      </div>

      <div className="acts no-print">
        {onOpenCard !== undefined && (
          <button className="secondary" onClick={(e) => { e.stopPropagation(); onOpenCard(); }}>Card</button>
        )}
        {entry.status === 'waiting' && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onStatus('in_chamber'); }}>Call in</button>
            <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('left'); }}>Left</button>
          </>
        )}
        {entry.status === 'in_chamber' && onRecord !== undefined && (
          <button onClick={(e) => { e.stopPropagation(); onRecord(); }}>Record</button>
        )}
        {entry.status === 'in_chamber' && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onStatus('done'); }}>Seen</button>
            <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('waiting'); }}>Back to waiting</button>
          </>
        )}
        {entry.status === 'done' && (
          <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('in_chamber'); }}>Undo</button>
        )}
        {entry.status === 'left' && (
          <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('waiting'); }}>Came back</button>
        )}
      </div>
    </div>
  );
}
