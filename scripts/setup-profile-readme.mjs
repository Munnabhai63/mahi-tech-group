// Creates the special profile repo + professional README (idempotent)
const H = {
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json'
};

const create = await fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    name: 'Munnabhai63',
    description: 'Profile README — full-stack engineer & platform builder',
    private: false,
    auto_init: false,
    has_issues: false,
    has_projects: false,
    has_wiki: false,
    has_downloads: false
  })
});
console.log('create repo:', create.status, create.status === 422 ? '(already exists — updating README)' : '(created)');

const readme = `<!-- MUNNABHAI63 - PROFILE README -->

# Hi, I'm Munaf 👋

**Full-Stack Engineer & Platform Builder** - I design and ship production-grade systems end to end: APIs, real-time collaboration, payments, identity & access automation, and the developer tooling around them.

Currently building **[Mahi Tech Group](https://github.com/mahi-tech-group)** - a decentralized team orchestration platform where teams ideate, vote, execute projects in parallel tracks, and share revenue automatically.

---

### What I work with

\`\`\`text
Backend     Node.js 24 / Express 5 / WebSocket / SQLite / REST + HMAC webhooks
Security    AES-256-GCM / bcrypt / JWT + session revocation / rate limiting / CSP
Payments    Self-hosted UPI gateway integration (0% fee) / ledger & payout engines
Automation  GitHub REST APIs / org & team provisioning / PR<->task pipelines / CI
Frontend    Vanilla JS design systems / Canvas real-time collaboration / Playwright QA
Practices   TDD (24 automated suites) / append-only audit trails / honest stubs policy
\`\`\`

### Highlight: Mahi Tech Group

> Vote -> Build -> Ship -> Split. A full platform where approved ideas fan out into
> 9 parallel tracks, real money moves through a self-hosted UPI gateway, revenue
> splits are penny-perfect, and every member's legal signatures are tamper-proof.

- Zero-trust auth with automatic access revocation on offboarding
- Quadratic supermajority voting with quorum auto-extension
- Immutable revenue ledger with contribution-weighted splits
- GitHub-native project pipelines (branch -> PR -> task, synced both ways)

### Reach me

- GitHub: [@Munnabhai63](https://github.com/Munnabhai63)
- Organization: [@mahi-tech-group](https://github.com/mahi-tech-group)

---

<sub>Building in public, one verified commit at a time.</sub>
`;

// Check existing file to get sha for update
const existing = await fetch('https://api.github.com/repos/Munnabhai63/Munnabhai63/contents/README.md', { headers: H });
let sha;
if (existing.status === 200) {
  sha = (await existing.json()).sha;
}

const put = await fetch('https://api.github.com/repos/Munnabhai63/Munnabhai63/contents/README.md', {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({
    message: sha ? 'Update profile README' : 'Professional profile README',
    content: Buffer.from(readme).toString('base64'),
    ...(sha ? { sha } : {})
  })
});
console.log('README:', put.status === 200 || put.status === 201 ? 'SAVED ✓' : put.status + ' ' + JSON.stringify(await put.json()).slice(0, 150));
