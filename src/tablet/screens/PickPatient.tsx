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
  { queue, onPick, onPapers, bn }: {
    queue: QueueEntryWithConsent[];
    /** Open the screening questions to add to or correct what is there. */
    onPick: (entry: QueueEntryWithConsent) => void;
    /** Open the camera and the papers already taken for this patient. */
    onPapers: (entry: QueueEntryWithConsent) => void;
    bn: boolean;
  },
) {
  /**
   * Everybody still in play, with the patient who is WITH THE DOCTOR at
   * the top.
   *
   * The desk could not see who was in the room. That matters twice a
   * minute: somebody asks "am I next?", and the assistant has to know
   * who is actually in there and who was called and did not come. Both
   * are on the card now, and the one in the room is first.
   */
  const shown = queue
    .filter((e) => e.status === 'waiting' || e.status === 'in_chamber')
    .sort((a, b) => {
      const rank = (e: QueueEntryWithConsent) => (e.status === 'in_chamber' ? 0 : 1);
      return rank(a) - rank(b);
    });

  return (
    <>
      <div className="prompt">
        <div className="bn">{bn ? 'আজকের তালিকা' : "Today's list"}</div>
        <div className="en">{bn ? "Today's list" : 'আজকের তালিকা'}</div>
      </div>

      <div className="patient-list">
        {shown.length === 0 ? (
          <div className="empty">
            {bn ? 'এখন লাইনে কেউ নেই।' : 'Nobody is waiting.'}
            <br />
            <span style={{ fontSize: 16 }}>
              {bn ? '"রোগী এসেছেন" চেপে প্রথম রোগীকে সিরিয়াল দিন।' : 'Tap "A patient has arrived" to give the first serial.'}
            </span>
          </div>
        ) : shown.map((entry) => {
          const withDoctor = entry.status === 'in_chamber';
          const noAnswer = entry.calledNoAnswer > 0;
          return (
            /* A DIV, not a button.
               Tapping anywhere used to start the screening questions all
               over again for somebody whose history had already been
               taken at the desk. Nothing happens by touching a card now;
               the two things an assistant can do are written on two
               buttons that say what they do. */
            <div
              key={entry.visitId}
              className={`patient ${entry.redFlags.length > 0 ? 'flagged' : ''} ${withDoctor ? 'inchamber' : ''}`}
            >
              <span className="serial">{entry.serialNo}</span>
              <span className="who">
                <span className="nm">{entry.nameBn ?? entry.nameEn}</span>
                <span className="sub">
                  {entry.ageYears === null ? (bn ? 'বয়স জানা নেই' : 'age not known') : `${entry.ageYears}`}
                  {entry.sex !== null && ` · ${entry.sex}`}
                </span>
                <span className="states">
                  {withDoctor && (
                    <span className="state indoc">
                      {bn ? 'এখন ডাক্তারের কাছে' : 'with the doctor now'}
                    </span>
                  )}
                  {noAnswer && !withDoctor && (
                    <span className="state skipped">
                      {bn
                        ? `ডাকা হয়েছে, আসেননি${entry.calledNoAnswer > 1 ? ` (${entry.calledNoAnswer})` : ''}`
                        : `called, did not come${entry.calledNoAnswer > 1 ? ` (${entry.calledNoAnswer})` : ''}`}
                    </span>
                  )}
                  {entry.consent?.careRecord === 'declined' && (
                    <span className="state">{bn ? 'অনুমতি দেননি' : 'said no'}</span>
                  )}
                  {entry.visitKind === 'reports_only'
                    && <span className="state reports">{bn ? 'শুধু রিপোর্ট' : 'reports only'}</span>}
                  {entry.intakeCompleted && <span className="state done">{bn ? 'নেওয়া হয়েছে' : 'done'}</span>}
                  {!entry.intakeCompleted && entry.intakeStarted && entry.consent?.careRecord !== 'declined' && (
                    <span className="state">{bn ? 'অসম্পূর্ণ' : 'part done'}</span>
                  )}
                </span>

                {/* The only two things that DO anything, and each says
                    which it is before it is pressed. */}
                <span className="acts">
                  <button className="row-act" onClick={() => onPick(entry)}>
                    {entry.intakeCompleted
                      ? (bn ? 'তথ্য যোগ / সংশোধন' : 'Add or correct information')
                      : (bn ? 'তথ্য নিন' : 'Take the information')}
                  </button>
                  <button className="row-act" onClick={() => onPapers(entry)}>
                    {entry.attachmentCount > 0
                      ? (bn ? `কাগজ (${entry.attachmentCount}টি) — আরও যোগ করুন` : `Papers (${entry.attachmentCount}) — add more`)
                      : (bn ? 'কোনো কাগজ নেই — ছবি তুলুন' : 'No papers yet — photograph')}
                  </button>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
