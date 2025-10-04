# GitHub Conventions Guide

*A quick reference for our team's GitHub workflow. Read time: ~5 minutes*

---

## Typical Workflow

**Day-to-day process:**

1. **Pick a task** - Look at open issues, assign one to yourself
2. **Create branch** - `git checkout -b feature/task-name`
3. **Work and commit** - Make changes, commit with proper messages
4. **Push and PR** - Push branch, open pull request
5. **Review** - Get teammate approval
6. **Merge** - Merge PR, delete branch
7. **Close issue** - Issue closes automatically if you used `Closes #X`

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
git push origin feat/add-user-dashboard
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



