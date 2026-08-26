import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import type { ChamberCardView } from '../../shared/ipc';

/**
 * Which room am I in?
 *
 * The first thing the doctor answers when he opens the laptop, because
 * everything after it follows: whose list he sees, which tablet is his
 * desk, and which register a serial number comes out of.
 *
 * Each card carries enough to tell him what he is walking into before
 * he taps it. If both chambers have people in them, the one with an
 * unacknowledged warning is the one to open first, and it says so.
 */
export function WhichChamber(
  { onPick, signedInName, canEdit }: {
    onPick: (chamberId: string, name: string) => void;
    signedInName: string;
    /** The doctor names his own rooms. The front desk never does. */
    canEdit: boolean;
  },
) {
  const [chambers, setChambers] = useState<ChamberCardView[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Which card is being renamed, and to what. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const read = useCallback(async () => {
    const { value, failure } = unwrap(await api.chamberCards());
    if (failure) { setFailure(failure); return; }
    setChambers(value!.chambers);
  }, []);

  useEffect(() => { void read(); }, [read]);
  // People keep arriving at both chambers while he is deciding.
  useEffect(() => {
    const timer = setInterval(() => { void read(); }, 10000);
    return () => clearInterval(timer);
  }, [read]);

  async function saveName(): Promise<void> {
    if (editing === null) return;
    const { failure } = unwrap(await api.chamberRename(editing.id, editing.name));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setEditing(null);
    await read();
  }

  async function pickLogo(chamberId: string): Promise<void> {
    const { failure } = unwrap(await api.chamberSetLogo(chamberId));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await read();
  }

  async function dropLogo(chamberId: string): Promise<void> {
    const { failure } = unwrap(await api.chamberClearLogo(chamberId));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await read();
  }

  if (failure !== null && chambers === null) {
    return <div className="page"><FailureNotice failure={failure} /></div>;
  }
  if (chambers === null) return <div className="page"><p className="muted">Reading…</p></div>;

  return (
    <div className="which-chamber">
      <h1>Which chamber are you in?</h1>
      <p className="subtitle">
        {signedInName}, this decides whose list you see and which front desk you are connected to.
      </p>

      {failure !== null && <FailureNotice failure={failure} />}

      {editing !== null && (
        <div className="card chamber-edit">
          <h2>What is this chamber called?</h2>
          <p className="muted">
            This is the name on the card you tap every evening, and the name printed
            at the top of the day's list.
          </p>
          <input
            value={editing.name}
            autoFocus
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); }}
          />
          <div className="acts">
            <button onClick={() => { void saveName(); }} disabled={editing.name.trim() === ''}>Save</button>
            <button className="secondary" onClick={() => { void pickLogo(editing.id); }}>
              Choose a logo…
            </button>
            {chambers.find((c) => c.id === editing.id)?.logo != null && (
              <button className="secondary" onClick={() => { void dropLogo(editing.id); }}>
                Remove the logo
              </button>
            )}
            <button className="secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
          <p className="muted small">
            A PNG, JPEG or SVG under 512 KB. It is shown small, on this screen — a
            photograph is not needed, and a large one goes into every backup.
          </p>
        </div>
      )}

      {chambers.length === 0 ? (
        <div className="card">
          <p>No chambers have been set up in this installation yet.</p>
        </div>
      ) : (
        <div className="chamber-cards">
          {chambers.map((chamber) => (
            <div key={chamber.id} className="chamber-slot">
            <button
              className={chamber.flagged > 0 ? 'chamber-card flagged' : 'chamber-card'}
              onClick={() => {
                void (async () => {
                  const { failure } = unwrap(await api.queueSetChamber(chamber.id));
                  if (failure) { setFailure(failure); return; }
                  onPick(chamber.id, chamber.name);
                })();
              }}
            >
              {/* The mark on the door of the building, which is faster
                  to tell apart than two lines of text. */}
              {chamber.logo !== null && (
                <img className="clogo" src={chamber.logo} alt="" />
              )}
              <span className="cname">{chamber.name}</span>

              {chamber.flagged > 0 && (
                <span className="cflag">
                  {chamber.flagged} {chamber.flagged === 1 ? 'warning' : 'warnings'} not yet seen
                </span>
              )}

              <span className="cnums">
                <span className="cn"><b>{chamber.waiting}</b>waiting</span>
                <span className="cn"><b>{chamber.withDoctor}</b>with the doctor</span>
                <span className="cn"><b>{chamber.seen}</b>seen</span>
              </span>

              <span className="cfoot">
                {chamber.longestWaitMinutes !== null && chamber.waiting > 0
                  ? chamber.longestWaitMinutes === 0
                    ? 'longest wait under a minute'
                    : `longest wait ${chamber.longestWaitMinutes} min`
                  : chamber.waiting === 0 && chamber.seen === 0
                    ? 'nobody has arrived here today'
                    : 'nobody waiting'}
                {chamber.reportsOnly > 0 && ` · ${chamber.reportsOnly} showing reports`}
              </span>

              <span className={chamber.tabletPaired ? 'ctablet on' : 'ctablet'}>
                {chamber.tabletPaired ? 'front desk tablet connected' : 'no tablet paired here yet'}
              </span>
            </button>

            {/* Outside the card, because the card is one big button and a
                button inside a button is a tap that does two things. */}
            {canEdit && (
              <button className="cedit" onClick={() => setEditing({ id: chamber.id, name: chamber.name })}>
                Name and logo
              </button>
            )}
          </div>
          ))}
        </div>
      )}
    </div>
  );
}
