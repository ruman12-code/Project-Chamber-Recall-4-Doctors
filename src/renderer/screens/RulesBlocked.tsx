import type { RedFlagStatus } from '../../shared/ipc';

/**
 * Shown instead of everything else when the red flag rules are not fit
 * to be used for real patients. There is no button to continue anyway,
 * and that is the entire point of the screen.
 */
export function RulesBlocked({ status }: { status: RedFlagStatus }) {
  return (
    <div className="page">
      <div className="blocked">
        <h1>This chamber's red flag rules are not ready</h1>
        <p>
          Patient records will not open until they are. The rules decide which patients get
          told to see the doctor immediately instead of waiting in the queue, so the software
          will not run for real patients with rules no doctor has approved.
        </p>

        <h2>What has to be fixed</h2>
        <ol>
          {status.blocksLiveUse.map((block, i) => (
            <li key={i}>
              <div className="r">{block.reason}</div>
              <div>{block.whatToDo}</div>
            </li>
          ))}
        </ol>

        {status.problems.length > 0 && (
          <>
            <h2>Problems found in the file</h2>
            <ol>
              {status.problems.map((problem, i) => (
                <li key={i}>
                  <div className="problem-line">
                    {problem.line === null ? problem.where : `line ${problem.line} · ${problem.where}`}
                  </div>
                  <div className="r">{problem.problem}</div>
                  <div>{problem.whatToDo}</div>
                </li>
              ))}
            </ol>
          </>
        )}

        <h2>The file to edit</h2>
        <p className="problem-line">{status.path}</p>
        <p className="muted">
          Open it in any text editor. Save it, then close and reopen this program to check it again.
        </p>
      </div>
    </div>
  );
}
