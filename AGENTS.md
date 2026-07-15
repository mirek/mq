# Working on mq

Treat [SPEC.md](./SPEC.md) as the source of truth for observable behavior and
[PLAN.md](./PLAN.md) as the implementation order. Update both in the same pull
request when a decision or milestone changes.

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
