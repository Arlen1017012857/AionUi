---
name: todo
description: Manage workspace TODO items through the TODO SkillApp.
---

# TODO SkillApp

Use this skill when the user wants to create, review, prioritize, complete, or reorganize TODO items, work plans, checklists, or lightweight task boards.

When this skill is loaded, AionUi automatically opens the TODO SkillApp in the preview panel. Treat the TODO app as the source of truth for task state.

The active TODO SkillApp session is written to `.aionui/skillapps/todo/session.json` in the current workspace.

When the session file exists:

- Use `.claude/skills/todo/scripts/todoctl.js` to read or modify TODO items.
- Prefer `node .claude/skills/todo/scripts/todoctl.js list --json` before answering task-state questions.
- Use `create`, `update`, `complete`, or `delete` commands instead of editing ad hoc files.
- Writes made through `todoctl.js` automatically signal the TODO SkillApp to refresh.
- Treat `.claude/skills/todo/...` as a runtime projection only. If you need to modify the SkillApp itself, edit the managed bundle paths recorded in the session file such as `bundleRoot`, `skillRoot`, `frontendRoot`, and `backendRoot`.
- Do not search for `TODO.md` or infer task state from workspace files.

Guidelines:

- Use concise task titles that the user can scan quickly.
- Preserve user intent when editing or completing TODO items.
- If the user asks to reorganize a plan, consider due dates, status, priority language in the title or notes, and recently changed items.
- If the app reports a planning event, respond with a concrete proposed ordering or next action list.
- Do not assume TODO items are global; they are scoped to the current workspace unless the user says otherwise.
