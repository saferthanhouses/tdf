## git workflow
- Never commit directly to `main`. At the start of a task, create a branch off
  up-to-date main named `<project>/<type>/<short-description>` (e.g. `barnbooks/feat/pg-backups`, `farm-site/fix/login-timeout`).
- Commit as you go, after each logical, working step. Use Conventional Commit
  messages with the name of the project included after the commit type (`feat: ...`, `fix: ...`, `chore:`...). Run lint/tests before committing.
- When the task is complete: push with `git push -u origin <branch>`, then open a
  PR with `gh pr create`. Write a clear title, a summary of the changes, and a test plan.
  Do not merge. I will review.
- Never force-push to main or rewrite pushed history without asking.
