# Decision Log

## 2026-02-16

### Decision: Implement "Pseudo" Google Review Posting

**Reason**: Google Business Profile API does not allow 3rd party apps to create reviews directly to prevent spam.
**Impact**:

- User flow changes from "One-click post" to "Copy comment & Download photo -> Paste & Attach on Google Maps".
- Requires clipboard API and Blob download implementation in frontend.

### Decision: Use Vanilla JavaScript for Frontend

**Reason**: Existing project structure uses plain HTML/JS.
**Impact**: Low build complexity, but managing DOM state manual.

### Decision: AI Memory System

**Reason**: To maintain context across development sessions and different agents/machines.
**Impact**: Created `.agent/` directory with `context.md`, `decisions.md`, `current_task.md`, `session_log.md`, and `BOOTSTRAP.md`.
