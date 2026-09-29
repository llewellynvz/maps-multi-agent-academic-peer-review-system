# Repository governance

This document records how the MAPS repository is controlled, so that only the owner decides what reaches `main`. Settings marked **(GitHub setting)** are applied in the GitHub web interface by the repository owner. They cannot be set from files in the repository.

## Control model

| Goal | Mechanism |
|---|---|
| Only the owner can approve changes | [CODEOWNERS](../.github/CODEOWNERS) names @llewellynvz as owner of every file, and the ruleset requires code-owner approval. |
| No one can push to `main` directly | The ruleset requires a pull request. Only the repository admin role can bypass it. |
| History cannot be rewritten | Force-pushes and branch deletion on `main` are blocked. History is linear. |
| Broken or leaking code cannot merge | The `verify` and `secrets` checks must pass on the latest commit. |
| Approvals cannot be gamed | Approvals are dismissed on new pushes, the last push must be approved by someone other than its author, and every review thread must be resolved. |
| Forks confer no rights | The [LICENSE](../LICENSE) prohibits any use of forks. Pull requests from forks are closed unreviewed (see [CONTRIBUTING](../CONTRIBUTING.md)). |

## 1. Rename the repository (GitHub setting)

1. Open **Settings → General**.
2. Under **Repository name**, enter `maps-multi-agent-academic-peer-review-system`, then select **Rename**. (Done: the repository now lives at `llewellynvz/maps-multi-agent-academic-peer-review-system`.)
3. Under **Description**, enter: *MAPS: the Multi-Agent Academic Peer-Review System. A proprietary Psynalytics AI system.*

GitHub redirects the old URL, but update every local clone:

```bash
git remote set-url origin https://github.com/llewellynvz/maps-multi-agent-academic-peer-review-system.git
```

## 2. Import the branch ruleset (GitHub setting)

1. Open **Settings → Rules → Rulesets**.
2. Select **New ruleset → Import a ruleset**.
3. Choose [`.github/rulesets/protect-main.json`](../.github/rulesets/protect-main.json).
4. Review it, confirm **Enforcement status: Active**, and select **Create**.

The ruleset applies to the default branch and enforces the following:

- a pull request is required, with one approval, and that approval must come from the code owner;
- approvals are dismissed when new commits are pushed;
- the most recent push must be approved by someone other than the person who pushed it;
- every conversation must be resolved;
- the `verify` and `secrets` checks must pass on an up-to-date branch;
- history must be linear, and force-pushes and deletion are blocked;
- only the repository admin role (the owner) can bypass it.

## 3. Collaborator access (GitHub setting)

Open **Settings → Collaborators and teams**.

- **@leondebeer: Write.** They can create branches and open pull requests. Under the ruleset nothing they write reaches `main` without the owner's approval.
- Grant no one else Write, Maintain, or Admin. Anyone who only needs to read the code should have **Read**.

## 4. Actions and fork safety (GitHub setting)

Open **Settings → Actions → General**.

1. **Fork pull request workflows from outside collaborators:** select **Require approval for all outside collaborators**, so no fork can run code in CI without the owner's approval.
2. **Workflow permissions:** select **Read repository contents and packages permissions**, and leave **Allow GitHub Actions to create and approve pull requests** unchecked.

## 5. Forking and visibility

The repository is public, and GitHub does not allow forking to be disabled on a public repository in a personal account. The protections above ensure that a fork can never change this repository. The [LICENSE](../LICENSE) removes any right to use, run, or distribute a fork.

To stop viewing and forking entirely, change the visibility to private under **Settings → General → Danger Zone → Change repository visibility**. Existing public forks are not deleted when you do this; they are detached into separate repositories.

## 6. Verifying the setup

After applying the settings, confirm the following:

- A push straight to `main` from any account other than the owner's is rejected.
- A pull request shows **Review required** from @llewellynvz and cannot be merged until the owner approves and `verify` and `secrets` pass.
- **Insights → Forks** lists any existing forks. The licence governs these, but they cannot affect this repository.
