# 🤝 Team Collaboration & Contribution Guidelines

Welcome to the **Mahi Tech Group** platform development team.

To maintain code security, system stability, and clear ownership, all contributors must strictly adhere to this workflow.

---

## 🔒 Golden Rules

1. **Never Push Directly to `master`**: Direct pushes to `master` are blocked by branch protection. All code must enter through a **Pull Request (PR)**.
2. **Never Commit Secrets**: Never commit `.env`, API keys, passwords, database files (`*.sqlite`), or credentials.
3. **Branch from `master`**: Always pull the latest `master` before starting a new task.
4. **Owner Approval Required**: Every PR must be reviewed and merged by the Project Owner.

---

## 🌿 Branch Naming Convention

Always create a dedicated feature branch with your role prefix:

| Role | Branch Prefix | Example |
| :--- | :--- | :--- |
| **Developer** | `dev/<feature-name>` | `git checkout -b dev/wallet-sync-fix` |
| **UI/UX Designer** | `ui/<screen-name>` | `git checkout -b ui/superadmin-dark-theme` |
| **Researcher** | `research/<topic>` | `git checkout -b research/quadratic-voting-spec` |
| **Producer / PM** | `pm/<milestone>` | `git checkout -b pm/sprint-1-deliverables` |

---

## 🛠️ Step-by-Step Developer Workflow

### 1. Clone & Set Up Local Environment
```bash
git clone https://github.com/Munnabhai63/mahi-tech-group.git
cd mahi-tech-group
npm install
```

### 2. Configure Local Settings
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Initialize your local database schema and test seeds:
```bash
npm run migrate
npm run seed
```

### 3. Create Your Working Branch
```bash
git checkout -b dev/your-feature-name
```

### 4. Test Before Pushing
Run local tests to ensure no regressions:
```bash
npm test
```

### 5. Commit & Push Your Branch
```bash
git add .
git commit -m "feat(module): brief description of changes"
git push origin dev/your-feature-name
```

### 6. Create a Pull Request (PR)
1. Go to the GitHub repository: [https://github.com/Munnabhai63/mahi-tech-group](https://github.com/Munnabhai63/mahi-tech-group).
2. Click **"Compare & pull request"**.
3. Fill out the PR template form.
4. Wait for the automated CI test check to pass and the Project Owner to review and merge your PR into `master`.
