# GitHub Conventions Guide

---

## Typical Workflow

**Day-to-day process:**

1. **Pick a task** - Look at open issues, assign one to yourself
2. **Ensure clean state** - Commit or stash any uncommitted changes
3. **Create branch** - `git checkout -b feature/task-name` (or use VS Code Source Control UI)
4. **Work and commit** - Make changes, commit with proper messages
5. **Push and PR** - Publish branch, open pull request
6. **Review** - Get teammate approval
7. **Merge** - Merge PR, delete branch
8. **Close issue** - Issue closes automatically if you used `Closes #X`

**Example:**
```bash
# Start new work
git checkout main
git pull
git checkout -b feat/add-user-dashboard

# Make changes and commit
git add .
git commit -m "feat: add user dashboard layout"

# Push and create PR
git push -u origin feat/add-user-dashboard
# Then open PR on GitHub linking to issue
```

---

## Branch Naming

**Format:** `<type>/<short-description>`

**Types:**
- `feat/` - New features
- `fix/` - Bug fixes
- `test/` - Adding tests to existing code
- `chore/` - Maintenance (includes refactoring, dependency updates, docs, config)

**Examples:**
```
feat/add-user-login
fix/correct-password-validation
test/add-authentication-tests
chore/update-readme
chore/upgrade-dependencies
chore/refactor-auth-logic
```

**Rules:**
- Use lowercase and hyphens (kebab-case)
- Keep names clear and concise
- Delete branches after merging

**Note on Testing:**
- Use `test/` branches when adding tests to existing untested code
- For new features, include tests in the same `feat/` branch
- For bug fixes, include tests in the same `fix/` branch

---

## Commit Messages

**Format:** `type: brief description`

**Common Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code cleanup
- `test:` - Adding tests
- `chore:` - Maintenance (docs, dependencies, config, etc.)

**Examples:**
```
feat: add user registration
fix: correct login validation error
chore: update README installation steps
refactor: simplify database connection logic
chore: upgrade React to v18
```

**Best Practices:**
- Keep first line under 50 characters
- Use imperative mood: "add" not "added"
- Reference issues when relevant: `fix: login error (closes #12)`
- Add detailed explanation in body if needed (optional)

**Template:**
```
<type>: <brief description>

[Optional body: detailed explanation of what and why]

[Optional footer: issue references]
```

**Full Example:**
```
feat: add password reset functionality

Implemented email-based password reset flow.
Users receive a reset link valid for 1 hour.

Closes #25
```

---

## Pull Requests

**Title Format:** Same as commits: `type: description`
- Example: `feat: add user profile page`

**Required in Description:**
```markdown
## What This Does
Brief explanation (2-3 sentences)

## Related Issue
Closes #[number]

## Testing
- [ ] Tested locally and works
- [ ] All tests pass
```
*Note: Check boxes by replacing `[ ]` with `[x]`*

**PR Workflow:**
1. Push your branch to GitHub
2. Open PR with clear title and description
3. Link the related issue using `Closes #123`
4. Request review from at least one teammate
5. Address feedback if any
6. Merge after approval

**Rules:**
- Get **at least 1 approval** before merging
- Resolve all merge conflicts
- Ensure tests pass
- Keep PRs focused (one feature/fix per PR)

**Choosing a Reviewer:**
- **Frontend changes** → Request review from someone familiar with React/TypeScript
- **Backend changes** → Request review from someone who works with Python/FastAPI
- **Full-stack changes** → Consider requesting 2 reviewers (one for each side)
- **Documentation/config** → Any active team member can review
- **When unsure** → Ask in team chat or request review from the most active contributor
- **Small teams** → Rotate reviewers to share knowledge across the team

---

## Issues

**Create Issues For:**
- New features
- Bugs
- Documentation tasks
- Questions or discussions

**Title Guidelines:**
- ✅ "Add user login form"
- ✅ "Fix password validation error"
- ❌ "Login stuff"
- ❌ "Bug"

**Simple Template:**

**For tasks/bugs:**
```markdown
## Description
What needs to be done or what's broken?

## Details (for bugs)
Steps to reproduce:
1. Do this
2. Then this
3. See error

Expected: [what should happen]
Actual: [what actually happens]

## Additional Context
Screenshots, ideas, or relevant info
```

**For questions/discussions:**
```markdown
## Question/Discussion
What needs to be discussed or decided?

## Context
Why is this question coming up?

## Options (if applicable)
1. Option A - pros and cons
2. Option B - pros and cons

## Impact
Who/what does this affect?

## Additional Info
Links, screenshots, or relevant context
```

**Best Practices:**
- Assign issues when you start working on them
- Reference issue numbers in commits: `closes #12`
- Close issues when work is merged

---

## Quick Reference

### Before Committing
- [ ] Code works and is tested
- [ ] Commit message follows format
- [ ] No sensitive data (passwords, API keys)

### Before Creating PR
- [ ] Branch is up to date with main
- [ ] PR title and description are complete
- [ ] Linked to issue with `Closes #X`

### Before Merging
- [ ] At least 1 approval
- [ ] Tests passing
- [ ] Feedback addressed
- [ ] No merge conflicts

---

## Further Reading

This guide covers our team's common patterns. For deeper understanding:

- **Git workflow fundamentals**: [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)
- **Branch naming conventions**: [Conventional Branch](https://conventional-branch.github.io/)
- **Commit message best practices**: [Conventional Commits](https://www.conventionalcommits.org/)
- **Pull request reviews**: [How to review code](https://google.github.io/eng-practices/review/reviewer/) - Google's engineering practices

---



