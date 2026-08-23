import { useEffect, useRef, useState } from 'react';
import type { Question } from '../../main/intake/flow';

/**
 * One question, filling the screen.
 *
 * Three things are on every single one of these screens and cannot be
 * taken off any of them:
 *
 *   SKIP. An assistant trapped behind a question a patient cannot
 *   answer stops using the tablet, and then nothing gets asked at all.
 *
 *   STOP. The whole intake can be ended at any point. A short intake is
 *   a good outcome; an abandoned tablet is not.
 *
 *   BACK. To the patient list, without losing what has been answered.
 */
export function Ask(
  { question, existing, index, total, bn, onAnswer, onSkip, onFinish, onBack }: {
    question: Question;
    existing: { value: string | null; freeText: string | null } | undefined;
    index: number; total: number; bn: boolean;
    onAnswer: (answer: { value: string | null; freeText: string | null }) => void;
    onSkip: () => void;
    onFinish: () => void;
    onBack: () => void;
  },
) {
  const [text, setText] = useState(existing?.freeText ?? '');
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(existing?.freeText ?? ''); }, [question.key, existing?.freeText]);
  useEffect(() => { if (question.type === 'free_text') textarea.current?.focus(); }, [question.key, question.type]);

  const first = bn ? question.prompt.bn : question.prompt.en;
  const second = bn ? question.prompt.en : question.prompt.bn;
  const help = question.help === null ? null : (bn ? question.help.bn : question.help.en);

  const columns = question.type === 'scale' ? 'three'
    : question.options.length > 5 ? 'three' : question.options.length > 2 ? 'two' : '';

  return (
    <>
      <div className="prompt">
        <div className="bn">{first}</div>
        <div className="en">{second}</div>
        {help !== null && <div className="help">{help}</div>}
      </div>

      {question.type === 'free_text' ? (
        <div className="answers">
          <textarea
            ref={textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={bn ? 'রোগী যা বলছেন, লিখুন…' : "Write what the patient says…"}
          />
        </div>
      ) : (
        <div className={`answers ${columns}`}>
          {question.options.map((option) => (
            <button
              key={option.value}
              className={`opt ${question.type === 'scale' ? 'scale' : ''} ${existing?.value === option.value ? 'on' : ''}`}
              onClick={() => onAnswer({ value: option.value, freeText: null })}
            >
              {bn ? option.label.bn : option.label.en}
              <span className="en">{bn ? option.label.en : option.label.bn}</span>
            </button>
          ))}
        </div>
      )}

      <div className="footbar">
        <button className="btn ghost small" onClick={onBack}>{bn ? '← তালিকা' : '← List'}</button>
        <span className="progress">{index + 1} / {total}</span>
        <button className="btn ghost" onClick={onSkip}>{bn ? 'বাদ দিন' : 'Skip'}</button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onFinish}>{bn ? 'শেষ করুন' : 'Stop here'}</button>
        {question.type === 'free_text' && (
          <button className="btn" onClick={() => onAnswer({ value: null, freeText: text.trim() === '' ? null : text.trim() })}>
            {bn ? 'পরের প্রশ্ন' : 'Next'}
          </button>
        )}
      </div>
    </>
  );
}
