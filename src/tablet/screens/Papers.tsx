import { useRef, useState } from 'react';
import { api } from '../api';

/**
 * Photographing the paper the patient brought.
 *
 * A patient here carries their history in a plastic bag: lab reports,
 * old prescriptions, a discharge summary from three years ago. It
 * walks back out of the door five minutes later. This is the one
 * chance the record ever gets at it.
 *
 * Three things this screen has to get right:
 *
 *   It must never say a photograph is saved when it is not. Every one
 *   is sent as it is taken and shown as sent or not sent, and a failed
 *   one stays on screen with a Try again beside it.
 *
 *   Losing one must not be a disaster, and it is not: the paper is
 *   still in the assistant's hand. So this does NOT queue photographs
 *   for later like everything else the tablet does - a queue would
 *   fill the tablet's storage and fail quietly. Straight out, or told
 *   about at once.
 *
 *   It must be skippable in one tap. Most patients bring nothing, and
 *   a screen that makes them all stop is a screen that gets rushed
 *   through for the ones who do.
 */

type Shot = {
  key: string;
  url: string;
  kind: Kind;
  state: 'sending' | 'saved' | 'failed';
  problem: string | null;
};

type Kind = 'report' | 'prescription_scan' | 'old_paper_file';

const KINDS: Array<{ value: Kind; bn: string; en: string }> = [
  { value: 'report', bn: 'রিপোর্ট', en: 'Test report' },
  { value: 'prescription_scan', bn: 'পুরোনো ব্যবস্থাপত্র', en: 'Old prescription' },
  { value: 'old_paper_file', bn: 'অন্য কাগজ', en: 'Other paper' },
];

/**
 * Shrinks the photograph before it is sent.
 *
 * A tablet camera produces four megabytes. Chamber wifi does not want
 * that forty times an evening, and neither does the records file. The
 * long edge is brought down to 1600 pixels, which still reads a lab
 * report's small print, and saved as JPEG.
 *
 * If anything about this fails - an odd file, a browser without
 * canvas - the original is sent unchanged rather than nothing at all.
 */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const original = { blob: file as Blob, width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > 1600 ? 1600 / longest : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return original;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (blob === null) return original;
    return { blob, width, height };
  } catch {
    return original;
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('the picture could not be read on the tablet'));
    reader.readAsDataURL(blob);
  });
}

export function Papers(
  { visitId, bn, onDone }: { visitId: string; bn: boolean; onDone: () => void },
) {
  const [kind, setKind] = useState<Kind>('report');
  const [shots, setShots] = useState<Shot[]>([]);
  const input = useRef<HTMLInputElement | null>(null);

  async function send(shot: Shot, blob: Blob, width: number, height: number) {
    try {
      const contentBase64 = await toBase64(blob);
      await api.post('/api/attachments', {
        visitId, kind: shot.kind, caption: null,
        contentBase64, contentType: 'image/jpeg', width, height,
      });
      setShots((all) => all.map((s) => (s.key === shot.key ? { ...s, state: 'saved', problem: null } : s)));
    } catch (caught) {
      const error = caught as Error & { whatToDo?: string };
      setShots((all) => all.map((s) => (s.key === shot.key
        ? { ...s, state: 'failed', problem: `${error.message} ${error.whatToDo ?? ''}`.trim() }
        : s)));
    }
  }

  async function take(files: FileList | null) {
    if (files === null) return;
    for (const file of Array.from(files)) {
      const { blob, width, height } = await shrink(file);
      const shot: Shot = {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: URL.createObjectURL(blob),
        kind,
        state: 'sending',
        problem: null,
      };
      setShots((all) => [...all, shot]);
      void send(shot, blob, width, height);
    }
    if (input.current !== null) input.current.value = '';
  }

  async function retry(shot: Shot) {
    setShots((all) => all.map((s) => (s.key === shot.key ? { ...s, state: 'sending', problem: null } : s)));
    const blob = await fetch(shot.url).then((r) => r.blob());
    void send(shot, blob, 0, 0);
  }

  const unsent = shots.filter((s) => s.state !== 'saved').length;

  return (
    <>
      <div className="prompt">
        <div className="bn">{bn ? 'কোনো কাগজ এনেছেন?' : 'Did they bring any papers?'}</div>
        <div className="en">
          {bn ? 'রিপোর্ট, পুরোনো ব্যবস্থাপত্র — ছবি তুলে রাখুন' : 'Reports, old prescriptions — photograph them'}
        </div>
      </div>

      <div className="paper-kinds">
        {KINDS.map((k) => (
          <button key={k.value} className={kind === k.value ? 'on' : ''} onClick={() => setKind(k.value)}>
            {bn ? k.bn : k.en}
          </button>
        ))}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="paper-input"
        aria-label={bn ? 'ছবি তুলুন' : 'Take a photograph'}
        onChange={(e) => { void take(e.target.files); }}
      />

      <button className="paper-take" onClick={() => input.current?.click()}>
        {bn ? '📷  ছবি তুলুন' : '📷  Take a photograph'}
      </button>

      <div className="paper-shots">
        {shots.map((shot) => (
          <div className={`paper-shot ${shot.state}`} key={shot.key}>
            <img src={shot.url} alt="" />
            <div className="state">
              {shot.state === 'sending' && (bn ? 'পাঠানো হচ্ছে…' : 'sending…')}
              {shot.state === 'saved' && (bn ? '✓ জমা হয়েছে' : '✓ saved')}
              {shot.state === 'failed' && (
                <>
                  <b>{bn ? 'জমা হয়নি' : 'not saved'}</b>
                  <span>{shot.problem}</span>
                  <button onClick={() => { void retry(shot); }}>{bn ? 'আবার চেষ্টা করুন' : 'Try again'}</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="arrive-actions">
        <button onClick={onDone}>
          {shots.length === 0
            ? (bn ? 'কিছু আনেননি' : 'They brought nothing')
            : (bn ? 'হয়ে গেছে' : 'Done')}
        </button>
      </div>

      {unsent > 0 && (
        <div className="notice bad">
          <div className="t">
            {bn
              ? `${unsent}টি ছবি এখনো জমা হয়নি।`
              : `${unsent} photograph${unsent === 1 ? '' : 's'} ${unsent === 1 ? 'has' : 'have'} not been saved.`}
          </div>
          <div className="d">
            {bn
              ? 'কাগজ এখনো আপনার হাতে আছে — আবার চেষ্টা করুন, অথবা কাগজটি আবার ছবি তুলুন।'
              : 'The paper is still in your hand — try again, or photograph it once more.'}
          </div>
        </div>
      )}
    </>
  );
}
