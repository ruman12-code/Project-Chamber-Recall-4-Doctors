import type { Failure } from './api';

/**
 * The only way an error is shown. It stays on screen until the user
 * does something about it: it does not fade, and it does not shrink to
 * an icon. The plain sentence comes first, what to do comes second, and
 * the developer detail is folded away underneath.
 */
export function FailureNotice({ failure }: { failure: Failure }) {
  return (
    <div className="failure" role="alert">
      <div className="what">{failure.userMessage}</div>
      <div className="do">{failure.whatToDo}</div>
      <details>
        <summary>Technical detail (for whoever maintains this software)</summary>
        <pre>{failure.technical}</pre>
      </details>
    </div>
  );
}
