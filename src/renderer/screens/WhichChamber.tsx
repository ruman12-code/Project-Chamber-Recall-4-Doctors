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
  { onPick, signedInName }: { onPick: (chamberId: string, name: string) => void; signedInName: string },
) {
  const [chambers, setChambers] = useState<ChamberCardView[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

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

      {chambers.length === 0 ? (
        <div className="card">
          <p>No chambers have been set up in this installation yet.</p>
        </div>
      ) : (
        <div className="chamber-cards">
          {chambers.map((chamber) => (
            <button
              key={chamber.id}
              className={chamber.flagged > 0 ? 'chamber-card flagged' : 'chamber-card'}
              onClick={() => {
                void (async () => {
                  const { failure } = unwrap(await api.queueSetChamber(chamber.id));
                  if (failure) { setFailure(failure); return; }
                  onPick(chamber.id, chamber.name);
                })();
              }}
            >
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
          ))}
        </div>
      )}
    </div>
  );
}
