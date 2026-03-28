# GitHub Setup Guide

Step-by-step instructions to push this project to GitHub and trigger your first automated release.

---

## Step 1 — Create the GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `pharmacy-prq-tool`
3. Visibility: **Private** (recommended for internal tooling)
4. **Do NOT** initialise with README, .gitignore, or licence — you already have these
5. Click **Create repository**

---

## Step 2 — Update your GitHub username in the project

Before pushing, replace `YOUR_GITHUB_USERNAME` in these three files:

```bash
# macOS / Linux
YOUR_USERNAME="your-actual-github-username"

sed -i '' "s/YOUR_GITHUB_USERNAME/$YOUR_USERNAME/g" README.md
sed -i '' "s/YOUR_GITHUB_USERNAME/$YOUR_USERNAME/g" CHANGELOG.md
sed -i '' "s/YOUR_GITHUB_USERNAME/$YOUR_USERNAME/g" package.json

# Windows (PowerShell)
# $username = "your-actual-github-username"
# (Get-Content README.md) -replace 'YOUR_GITHUB_USERNAME', $username | Set-Content README.md
# (Get-Content CHANGELOG.md) -replace 'YOUR_GITHUB_USERNAME', $username | Set-Content CHANGELOG.md
# (Get-Content package.json) -replace 'YOUR_GITHUB_USERNAME', $username | Set-Content package.json
```

---

## Step 3 — Initialise git and push

```bash
cd pharmacy-prq-tool

# Initialise repository
git init
git branch -M main

# Stage everything
git add .

# First commit
git commit -m "feat: initial release — PRQ Generator + Browser Launcher v1.0.0"

# Add remote (replace YOUR_GITHUB_USERNAME)
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/pharmacy-prq-tool.git

# Push
git push -u origin main
```

---

## Step 4 — Verify CI passes

1. Go to your repo on GitHub
2. Click **Actions** tab
3. You should see **CI** workflow running — it checks syntax and spec compliance
4. Wait for the green checkmark ✅

---

## Step 5 — Create your first release

```bash
# Make sure you're on main and everything is committed
git status

# Tag v1.0.0
git tag v1.0.0

# Push the tag — this triggers the Build & Release workflow
git push origin v1.0.0
```

---

## Step 6 — Watch the build

1. Go to **Actions** tab → **Build & Release** workflow
2. You'll see three parallel jobs:
   - **Build macOS** — runs on `macos-latest` (~5–8 min)
   - **Build Windows** — runs on `windows-latest` (~5–8 min)
   - **Create GitHub Release** — runs after both succeed (~1 min)
3. When complete, go to **Releases** tab — your release will be there with both files attached

---

## Step 7 — Share the download link

```
https://github.com/YOUR_GITHUB_USERNAME/pharmacy-prq-tool/releases/latest
```

- macOS users download the `.dmg`
- Windows users download the `.exe`

---

## Future releases

For every subsequent release:

```bash
# 1. Update version in package.json and CHANGELOG.md
# 2. Commit
git add package.json CHANGELOG.md
git commit -m "chore: release v1.1.0"

# 3. Tag and push
git tag v1.1.0
git push && git push --tags
```

That's it — the workflow handles the rest.

---

## Optional: Code signing

Without code signing, users will see a Gatekeeper / SmartScreen warning on first launch.
To remove the warning, you need code signing certificates:

### macOS (Apple Developer)

1. Obtain an Apple Developer ID certificate (requires paid Apple Developer account)
2. Export as `.p12`, base64-encode it:
   ```bash
   base64 -i certificate.p12 | pbcopy
   ```
3. Add these GitHub repository secrets (**Settings → Secrets → Actions**):
   - `MAC_CERT_P12_BASE64` — the base64 certificate
   - `MAC_CERT_PASSWORD` — the certificate password
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password from appleid.apple.com
   - `APPLE_TEAM_ID` — your 10-character Team ID
4. Uncomment the signing block in `.github/workflows/build-release.yml`

### Windows (EV Code Signing)

1. Obtain a Windows code signing certificate (e.g. from DigiCert, Sectigo)
2. Export as `.p12`, base64-encode it
3. Add repository secrets:
   - `WIN_CERT_P12_BASE64`
   - `WIN_CERT_PASSWORD`
4. Uncomment the signing block in `.github/workflows/build-release.yml`
