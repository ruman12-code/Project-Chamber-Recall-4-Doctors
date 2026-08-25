import type { QueueEntry } from '../../shared/queue';

/**
 * The queue as the tablet sees it, with whether each patient has
 * already been asked for permission. A returning patient who agreed
 * last year is not asked again unless the wording has changed.
 */
export type QueueEntryWithConsent = QueueEntry & {
  consent: { careRecord: string; research: string };
};

/**
 * Who is the assistant about to ask?
 *
 * Straight from today's list, biggest thing on the row being the serial
 * number, because that is what the assistant just called out. Patients
 * already asked are shown as done rather than hidden, so a half-finished
 * one can be picked up again.
 */
export function PickPatient(
  { queue, onPick, bn }: { queue: QueueEntryWithConsent[]; onPick: (entry: QueueEntryWithConsent) => void; bn: boolean },
) {
  const waiting = queue.filter((e) => e.status === 'waiting' || e.status === 'in_chamber');

  return (
    <>
      <div className="prompt">
        <div className="bn">{bn ? 'কার তথ্য নেবেন?' : 'Which patient?'}</div>
        <div className="en">{bn ? 'Which patient?' : 'কার তথ্য নেবেন?'}</div>
      </div>

      <div className="patient-list">
        {waiting.length === 0 ? (
          <div className="empty">
            {bn ? 'এখন লাইনে কেউ নেই।' : 'Nobody is waiting.'}
            <br />
            <span style={{ fontSize: 16 }}>
              {bn ? '"রোগী এসেছেন" চেপে প্রথম রোগীকে সিরিয়াল দিন।' : 'Tap "A patient has arrived" to give the first serial.'}
            </span>
          </div>
        ) : waiting.map((entry) => (
          <button
            key={entry.visitId}
            className={`patient ${entry.redFlags.length > 0 ? 'flagged' : ''}`}
            onClick={() => onPick(entry)}
          >
            <span className="serial">{entry.serialNo}</span>
            <span className="who">
              <span className="nm">{entry.nameBn ?? entry.nameEn}</span>
              <span className="sub">
                {entry.ageYears === null ? (bn ? 'বয়স জানা নেই' : 'age not known') : `${entry.ageYears}`}
                {entry.sex !== null && ` · ${entry.sex}`}
              </span>
            </span>
            {entry.consent?.careRecord === 'declined' && (
              <span className="state">{bn ? 'অনুমতি দেননি' : 'said no'}</span>
            )}
            {entry.visitKind === 'reports_only'
              && <span className="state reports">{bn ? 'শুধু রিপোর্ট' : 'reports only'}</span>}
            {entry.intakeCompleted && <span className="state done">{bn ? 'নেওয়া হয়েছে' : 'done'}</span>}
            {!entry.intakeCompleted && entry.intakeStarted && entry.consent?.careRecord !== 'declined' &&
              <span className="state">{bn ? 'অসম্পূর্ণ' : 'part done'}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
