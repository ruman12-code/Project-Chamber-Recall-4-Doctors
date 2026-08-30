import { useState } from 'react';
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
 *
 * FOUR THINGS A ROW CAN DO, AND NOT ONE OF THEM HAPPENS BY TOUCHING
 * THE CARD
 *
 * Take or correct the information. Photograph their papers. Say they
 * have gone home -- or that they are back. And, for somebody who
 * cannot wait, ask the doctor to see them now.
 *
 * Only the third and fourth touch the evening at all, and neither of
 * them can do anything on its own: "gone home" is undone by one tap on
 * the same row, and "see them now" is a question the doctor answers on
 * the laptop.
 */
export function PickPatient(
  { queue, onPick, onPapers, onLeft, onSendInNow, bn }: {
    queue: QueueEntryWithConsent[];
    /** Open the screening questions to add to or correct what is there. */
    onPick: (entry: QueueEntryWithConsent) => void;
    /** Open the camera and the papers already taken for this patient. */
    onPapers: (entry: QueueEntryWithConsent) => void;
    /** Gone home, or come back. Nothing is deleted either way. */
    onLeft: (entry: QueueEntryWithConsent, status: 'left' | 'waiting') => void;
    /**
     * The manual way in for somebody who cannot wait their turn. It
     * asks the doctor; it does not put them in the room.
     */
    onSendInNow: (entry: QueueEntryWithConsent) => void;
    bn: boolean;
  },
) {
  /** The row waiting for "yes, they really have gone home". */
  const [confirmingLeft, setConfirmingLeft] = useState<string | null>(null);
  /** The row waiting for "yes, ask the doctor to see them now". */
  const [confirmingNow, setConfirmingNow] = useState<string | null>(null);

  /**
   * Everybody still in play, with the patient who is WITH THE DOCTOR at
   * the top, and anybody who has gone home at the bottom.
   *
   * The desk could not see who was in the room. That matters twice a
   * minute: somebody asks "am I next?", and the assistant has to know
   * who is actually in there and who was called and did not come. Both
   * are on the card now, and the one in the room is first.
   *
   * Patients who left stay on the list rather than vanishing, because
   * they walk back in. Bottom of the list, quiet, one tap to return.
   */
  const shown = queue
    .filter((e) => e.status === 'waiting' || e.status === 'in_chamber' || e.status === 'left')
    .sort((a, b) => {
      const rank = (e: QueueEntryWithConsent) =>
        e.status === 'in_chamber' ? 0 : e.status === 'left' ? 2 : 1;
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
          const gone = entry.status === 'left';
          const noAnswer = entry.calledNoAnswer > 0;
          const flagged = entry.redFlags.length > 0;
          return (
            /* A DIV, not a button.
               Tapping anywhere used to start the screening questions all
               over again for somebody whose history had already been
               taken at the desk. Nothing happens by touching a card now;
               everything an assistant can do is written on a button that
               says what it does. */
            <div
              key={entry.visitId}
              className={`patient ${flagged ? 'flagged' : ''} ${withDoctor ? 'inchamber' : ''} ${gone ? 'gone' : ''}`}
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
                  {gone && (
                    <span className="state left">
                      {bn ? 'চলে গেছেন — ডাকা হবে না' : 'gone home — not being called'}
                    </span>
                  )}
                  {noAnswer && !withDoctor && !gone && (
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

                {/* Everything that DOES anything, and each says which it
                    is before it is pressed. */}
                <span className="acts">
                  {gone ? (
                    <button className="row-act back" onClick={() => onLeft(entry, 'waiting')}>
                      {bn ? 'ইনি ফিরে এসেছেন — তালিকায় ফেরান' : 'They are back — put them on the list'}
                    </button>
                  ) : (
                    <>
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
                    </>
                  )}

                  {/* Asked twice, because a mis-tap on a busy counter
                      should not take somebody out of the calling order
                      without a second of thought. It is undone by one
                      tap either way. */}
                  {!withDoctor && !gone && (
                    confirmingLeft === entry.visitId ? (
                      <>
                        <button className="row-act danger"
                          onClick={() => { setConfirmingLeft(null); onLeft(entry, 'left'); }}>
                          {bn ? 'হ্যাঁ, চলে গেছেন' : 'Yes, they have gone'}
                        </button>
                        <button className="row-act" onClick={() => setConfirmingLeft(null)}>
                          {bn ? 'না' : 'No'}
                        </button>
                      </>
                    ) : (
                      <button className="row-act quiet"
                        onClick={() => { setConfirmingNow(null); setConfirmingLeft(entry.visitId); }}>
                        {bn ? 'ইনি চলে গেছেন' : 'This patient has gone home'}
                      </button>
                    )
                  )}

                  {/* The manual intervention. It asks the doctor and
                      waits for his answer; it never puts anybody in the
                      room by itself. */}
                  {!withDoctor && !gone && (
                    confirmingNow === entry.visitId ? (
                      <>
                        <button className="row-act now"
                          onClick={() => { setConfirmingNow(null); onSendInNow(entry); }}>
                          {bn ? 'হ্যাঁ, ডাক্তারকে জানান' : 'Yes, ask the doctor'}
                        </button>
                        <button className="row-act" onClick={() => setConfirmingNow(null)}>
                          {bn ? 'না' : 'No'}
                        </button>
                      </>
                    ) : (
                      <button className={flagged ? 'row-act quiet urgent' : 'row-act quiet'}
                        onClick={() => { setConfirmingLeft(null); setConfirmingNow(entry.visitId); }}>
                        {bn ? 'এখনই ডাক্তারের কাছে পাঠাতে চান' : 'Ask the doctor to see them now'}
                      </button>
                    )
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
