# How IEMS is built with AI agents

I build IEMS with AI coding agents, mostly [Claude Code](https://claude.com/claude-code). This page describes how that works in practice, because "built with AI" can mean anything from pasting a chat answer to running a real engineering process. This is the second kind.

## Who does what

| Me | The agents |
|---|---|
| Know the plant: how SAP confirmations work, why a short idle after production is a micro-stop, which status IDs are easy to mix up | Read the code and the specs |
| Decide what gets built and what is out of scope | Implement on their own branch or worktree |
| Write the specification and the acceptance criteria for each job | Write tests and collect evidence |
| Review the evidence and accept or reject | Review each other's work for business logic, security and UI |
| Merge | Never merge |

Most of the domain rules in this repository, such as the eligibility gate in [jobs/sap_staging/README.md](../jobs/sap_staging/README.md), come from how the plant actually runs. An agent cannot know them until someone writes them down, so writing them down is a large part of my job.

## The loop

### 1. A job file

Each piece of work starts as a job file that I write. It states:

- the goal and the users it is for;
- the business invariants that must survive (for SAP: no hour posted twice, no hour without an operator);
- what is out of scope;
- the evidence that counts as done, per layer: unit test, simulator, real browser, live database, native process.

Larger jobs are split into waves of work packages that can run in parallel.

### 2. Parallel builds in isolation

Agents work on separate branches and git worktrees, so two agents never edit the same checkout. The branch names in this repository show the structure: `feat/` for a feature, `program/` for a parallel program split by area (UI, backend, data, platform), `qa/` for review passes split by business, security and visual quality.

Every agent keeps a checkpoint file: before editing, after each milestone, before long operations and on blockers. When an agent is resumed, it first checks the real state of git, processes and the database instead of trusting its own notes.

### 3. Cross-review

A different agent reviews each result against the job file. Reviews are split by concern, because one reviewer looking for everything tends to find only the obvious. Findings go back to the builder as new work, and the reviewer re-checks the fix.

### 4. Evidence over reports

These are rules from my job files, and they are the main reason the agents' work is usable:

- A completion message, an earlier report or an old green CI run is not proof of the current tree.
- A fix comes with a test that fails before the fix and passes after it.
- A fault-injection test must prove the injected path actually ran. If the injection was never reached, the test fails; it does not pass or skip.
- Negative controls: disable the feature under test in a scratch copy and show that the acceptance test fails for the intended reason.
- Counts come from raw logs, never retyped by hand.
- Test layers stay separate. A simulator result is never reported as a production result, and "zero stubs" is never claimed when fault injection was used.
- "Closed" means the acceptance criteria are met on the final source. Anything not verified is listed as not verified.

### 5. Pull request

The result lands through a pull request with five required CI checks (see the [README](../README.md#tests-and-ci)). Commits an agent wrote carry a `Co-Authored-By: Claude` trailer, so the history shows which work was agent-assisted.

## What this changed

With agents writing the code, my time goes to the parts that decide whether the system is correct: the payroll rules, the failure modes of SAP CPI, the review of evidence. It also means I spend more time writing precise specifications than I used to spend writing code, and the specifications are better for it.

The rules agents get in this repository are in [CLAUDE.md](../CLAUDE.md).
