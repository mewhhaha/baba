# gpt-5.3-codex spark Workflow For FEEDBACK.md

Use this file before taking any task in this directory.

## Model Target

These task cards are written for `gpt-5.3-codex spark` agents working in
parallel on the same repository. Assume each Spark run has limited surrounding
conversation and should rely on files in the repo, not memory.

Each Spark agent should:

- work one task file at a time;
- inspect the current repo first;
- make the smallest complete patch for that task;
- avoid cross-task refactors;
- leave unrelated dirty files alone;
- report exact files changed and commands run;
- stop after its task is verifiably complete or after it records a concrete
  blocker.

## Handoff Prompt Template

Use this shape when assigning a Spark agent:

```text
You are gpt-5.3-codex spark in /home/mewhhaha/src/baba.
Read tasks/000-spark-workflow.md first, then complete tasks/NNN-name.md.
Do not work on other tasks.
Do not commit.
Preserve unrelated dirty files.
Report changed files and exact checks run.
```

## Required First Commands

Run these before editing:

```sh
git status --short --branch
sed -n '437,528p' FEEDBACK.md
rg -n "Still unresolved|P0|P1|P2|Recommended implementation order" FEEDBACK.md
```

If the worktree is dirty, identify whether the dirty files are part of your
task. Do not revert other agents' work.

## Shared Rules

- Keep patches boring and local. Spark should not invent broad architecture
  unless the task explicitly asks for architecture work.
- Use `apply_patch` for manual edits.
- Prefer `rg` over grep/find.
- Do not update generated examples or runtime manifests unless your task says so
  or you are running final integration.
- Do not bump the version unless a task explicitly says to prepare a release.
- Do not commit unless explicitly asked by the coordinator.
- Keep docs in sync with behavior when the task changes user-visible behavior.

## Standard Local Checks

Use the smallest relevant checks while developing. The integration task runs the
full release gate.

Focused checks:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts
```

Full release gate:

```sh
deno task bootstrap:check
deno fmt --check
git diff --check
deno task check
deno task test
deno publish --dry-run --allow-dirty
```

## Done Report Template

Report back with:

```text
Task: tasks/NNN-name.md
Changed:
- path: short reason

Evidence:
- command: result

Notes:
- any remaining risk or follow-up
```

## Coordinator Notes

The coordinator should run the final integration task after parallel Spark work
lands. Spark agents should not mark `FEEDBACK.md` complete by themselves unless
their assigned task is the final release-gate audit.
