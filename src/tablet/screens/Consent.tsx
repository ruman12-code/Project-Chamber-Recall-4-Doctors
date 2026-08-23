import { useEffect, useRef, useState } from 'react';

export interface ConsentPart {
  kind: 'care_record' | 'research';
  title: { bn: string; en: string };
  points: Array<{ bn: string; en: string }>;
  accept: { bn: string; en: string };
  decline: { bn: string; en: string };
  declinedNote: { bn: string; en: string };
  audioAvailable: { bn: boolean; en: boolean };
  audioUrl: { bn: string | null; en: string | null };
}

export type ConsentMethod = 'audio' | 'read_aloud' | 'screen_only';
export type ConsentGivenBy = 'self' | 'family_member';

/**
 * Asking permission.
 *
 * Three things here are not conveniences and should not be traded away
 * for a faster screen:
 *
 *   SAYING NO IS ONE TAP, and it is available from the moment the
 *   screen appears. Nothing has to be listened to, read or filled in
 *   first. A refusal that costs more effort than agreement is not a
 *   free choice.
 *
 *   SAYING YES IS NOT. The patient has to have actually been told
 *   first - either the recording has played, or the assistant has said
 *   they read the words aloud. Consent from somebody who was shown a
 *   wall of text they cannot read is not informed consent, and a great
 *   many patients here cannot read it.
 *
 *   WHO AGREED IS RECORDED. Patients arrive with a son or a
 *   daughter-in-law who does the talking. A record that quietly treats
 *   that as the patient's own consent is a record that lies.
 */
export function Consent(
  { part, bn, onDecide }: {
    part: ConsentPart;
    bn: boolean;
    onDecide: (decision: 'given' | 'declined', method: ConsentMethod, givenBy: ConsentGivenBy) => void;
  },
) {
  const language = bn ? 'bn' : 'en';
  const [heard, setHeard] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [givenBy, setGivenBy] = useState<ConsentGivenBy>('self');
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const hasAudio = part.audioAvailable[language];
  const audioUrl = part.audioUrl[language];

  // A different permission is a different question: nothing carries
  // over from the last one.
  useEffect(() => { setHeard(false); setReadAloud(false); setGivenBy('self'); setPlaying(false); }, [part.kind]);

  const told = heard || readAloud;
  const method: ConsentMethod = heard ? 'audio' : readAloud ? 'read_aloud' : 'screen_only';

  return (
    <>
      <div className="prompt">
        <div className="bn">{bn ? part.title.bn : part.title.en}</div>
        <div className="en">{bn ? part.title.en : part.title.bn}</div>
      </div>

      <div className="answers consent-body">
        <ul className="consent-points">
          {part.points.map((point, i) => <li key={i}>{bn ? point.bn : point.en}</li>)}
        </ul>

        {hasAudio && audioUrl !== null ? (
          <div className="consent-audio">
            <audio
              ref={audio}
              src={audioUrl}
              onEnded={() => { setHeard(true); setPlaying(false); }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <button
              className="btn ghost big-audio"
              onClick={() => { if (playing) { audio.current?.pause(); } else { void audio.current?.play(); } }}
            >
              {playing ? (bn ? '⏸ থামান' : '⏸ Pause') : (bn ? '▶ শুনুন' : '▶ Play this aloud')}
            </button>
            {heard && <span className="consent-done">{bn ? '✓ শোনানো হয়েছে' : '✓ played'}</span>}
          </div>
        ) : (
          <div className="notice consent-noaudio">
            <div className="t">{bn ? 'রেকর্ডিং এখনো নেই — কথাগুলো রোগীকে পড়ে শোনান।' : 'No recording yet — read these words aloud to the patient.'}</div>
            <div className="d">
              {bn
                ? 'অনেক রোগী পড়তে পারেন না। না শোনালে অনুমতিটা আসলে বোঝানো হয় না।'
                : 'Many patients cannot read this screen. Without being read to, the permission has not really been explained.'}
            </div>
            <button className={`btn ghost ${readAloud ? 'chosen' : ''}`} style={{ marginTop: 12 }}
                    onClick={() => setReadAloud((v) => !v)}>
              {readAloud
                ? (bn ? '✓ আমি পড়ে শুনিয়েছি' : '✓ I read this aloud')
                : (bn ? 'আমি পড়ে শুনিয়েছি' : 'I read this aloud')}
            </button>
          </div>
        )}

        <div className="consent-who">
          <div className="k">{bn ? 'কে উত্তর দিচ্ছেন?' : 'Who is answering?'}</div>
          <div className="row">
            <button className={`btn ghost ${givenBy === 'self' ? 'chosen' : ''}`} onClick={() => setGivenBy('self')}>
              {bn ? 'রোগী নিজে' : 'The patient'}
            </button>
            <button className={`btn ghost ${givenBy === 'family_member' ? 'chosen' : ''}`} onClick={() => setGivenBy('family_member')}>
              {bn ? 'সাথের লোক' : 'Someone with them'}
            </button>
          </div>
        </div>
      </div>

      <div className="footbar consent-foot">
        {/* Refusing is always one tap. It is never behind anything. */}
        <button className="btn ghost decline" onClick={() => onDecide('declined', method, givenBy)}>
          {bn ? part.decline.bn : part.decline.en}
        </button>
        <span style={{ flex: 1 }} />
        {!told && (
          <span className="progress">
            {bn ? 'আগে শোনান বা পড়ে শোনান' : 'Play it or read it aloud first'}
          </span>
        )}
        <button className="btn" disabled={!told} onClick={() => onDecide('given', method, givenBy)}>
          {bn ? part.accept.bn : part.accept.en}
        </button>
      </div>
    </>
  );
}
