# BOOTSTRAP INSTRUCTIONS for Antigravity Agents

## 🚨 CRITICAL: READ THIS FIRST 🚨

You are entering an existing workflow. before taking ANY action, you MUST:

1.  **Read `.agent/context.md`**: Understand the project scope, tech stack, and constraints.
2.  **Read `.agent/session_log.md`**: See what happened in previous sessions.
3.  **Read `.agent/decisions.md`**: Understand the "Why" behind the code.
4.  **Read `.agent/current_task.md`**: This is your direct instruction for _what to do next_.

## Session Continuation Rules

Every session MUST adhere to the following lifecycle:

1.  **Start**: Read the files listed above to reconstruct context.
2.  **Work**: Update `current_task.md` as you progress (mark items as done, add new sub-tasks).
3.  **End**:
    - Append a summary of your work to `session_log.md`.
    - Update `current_task.md` to reflect the state you are leaving for the next agent.
    - If a major architectural decision was made, log it in `decisions.md`.

## Project Specifics

- **Root Directory**: `d:\YHD-db完成版` (or equivalent workspace root).
- **Frontend**: Vanilla JS modules in `public/`.
- **Backend**: Firebase Functions in `functions/`.

---

_If you are reading this, the system is working._
