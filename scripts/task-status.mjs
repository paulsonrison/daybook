import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const [ids, status, ...description] = process.argv.slice(2);
const board = JSON.parse(await readFile('docs/tasks.json', 'utf8'));
const transitions = {
  'Not started': ['To do'],
  'To do': ['In review'],
  'In review': ['To do', 'Done'],
  Done: [],
};
const tasks = ids?.split(',').map((id) => board.tasks.find((t) => t.id === id));
if (
  !tasks?.length ||
  tasks.some((t) => !t) ||
  !board.statuses.includes(status) ||
  !description.length
)
  throw new Error(
    'Use: node scripts/task-status.mjs ID[,ID] "status" "reason"',
  );
for (const task of tasks) {
  if (!transitions[task.status].includes(status))
    throw new Error(
      `Invalid transition ${task.id}: ${task.status} -> ${status}`,
    );
  if (status === 'In review' && !task.evidence.length)
    throw new Error(
      `${task.id} requires actual verification evidence before review.`,
    );
  if (status === 'Done') {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
    }).trim();
    if (
      branch !== 'main' ||
      !task.mergeCommit ||
      !task.review ||
      task.review.outstanding !== 0
    )
      throw new Error(
        'Done requires main, a merge commit, and a clear independent review.',
      );
    execFileSync('git', [
      'merge-base',
      '--is-ancestor',
      task.mergeCommit,
      'HEAD',
    ]);
  }
}
for (const task of tasks) {
  board.history.push({
    date: new Date().toISOString(),
    task: task.id,
    from: task.status,
    to: status,
    event: description.join(' '),
  });
  task.status = status;
}
await writeFile(
  'docs/tasks.json',
  await format(JSON.stringify(board), {
    ...(await resolveConfig('docs/tasks.json')),
    filepath: 'docs/tasks.json',
  }),
);
const clean = (value) =>
  String(value).replaceAll('|', '/').replaceAll('\n', ' ');
const lines = [
  '# Daybook implementation task board',
  '',
  'Branch: `codex/complete-daybook` · Design and implementation plan: approved.',
  '',
  'Lifecycle: **Not started → To do → In review → Done**. Review findings return work to To do; Done requires clean independent review and verified merge to main.',
  '',
  '[Plan](superpowers/plans/2026-11-09-complete-daybook.md) · [Design](superpowers/specs/2026-11-09-complete-daybook-design.md) · [Task history](tasks.json) · [Acceptance evidence](acceptance-matrix.md) · [Review ledger](implementation-progress.md)',
  '',
  '## Implementation work packages',
  '',
  '| Task | Work | Status |',
  '| --- | --- | --- |',
];
for (const task of board.tasks.filter((t) => t.id.startsWith('P')))
  lines.push(`| ${task.id} | ${clean(task.title)} | ${task.status} |`);
lines.push(
  '',
  '## Source user stories',
  '',
  '| Story | Work | Plan | Priority | Status |',
  '| --- | --- | --- | --- | --- |',
);
for (const task of board.tasks.filter((t) => t.id.startsWith('US-')))
  lines.push(
    `| ${task.id} | ${clean(task.title)} | ${task.planTask} | ${task.priority} | ${task.status} |`,
  );
await writeFile(
  'docs/tasks.md',
  await format(lines.join('\n') + '\n', {
    ...(await resolveConfig('docs/tasks.md')),
    filepath: 'docs/tasks.md',
  }),
);
console.log(`${tasks.map((t) => t.id).join(', ')} -> ${status}`);
