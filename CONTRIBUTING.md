# Contributing

## Reporting bugs

Open an issue with:
- OS and version (macOS 14.x / Windows 11)
- App version (shown in bottom-left of sidebar)
- Steps to reproduce
- Screenshot of the log panel if relevant

## Making changes

1. Clone the repo and run `npm install && npm start`
2. Make your changes in `src/`
3. Test locally with your actual source Excel files
4. Open a Pull Request against `main`

CI will automatically check syntax and spec compliance.

## Release process

See [README — Releasing](README.md#releasing) for the tag-based release workflow.

## Spec reference

The PRQ generation logic must conform to `Pharmacy_PRQ_Spec_v6.docx`. The spec version is documented in `CHANGELOG.md` under each release.
