# Working on mq

Treat [SPEC.md](./SPEC.md) as the source of truth for observable behavior and
[TODO.md](./TODO.md) as the index of remaining implementation work. Read the
relevant task in `todo/` before changing behavior.

All Markdown documentation and repository skills are live documents. Every
pull request must review affected documents and skills and update them in the
same pull request so they describe the resulting state.

Todos represent only work that remains. When a task is complete, delete its file
from `todo/` and remove its entry from `TODO.md`; never add a status, mark it
completed, or retain it as historical documentation. Keep the index ordered by
importance with the most important work first.

Keep `@prelude/mq` independent of CLI concerns. Keep filesystem access, process
exit codes, and argument parsing in `@prelude/mq-cli`.

Prefer Node.js built-ins and packages under `@prelude/*`. Introduce another
dependency only when it materially reduces correctness or maintenance risk, and
record the reason in the pull request.

For every behavior change, begin with an executable Node test that demonstrates
the expected public behavior. Test lossless round-trips and the smallest changed
source range for parser or mutation work.

Use the repository skills in `.agents/skills` when their descriptions match the
task.
