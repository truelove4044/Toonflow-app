# Repo Agent Rules

## Encoding Safety

- Treat all repo text files as UTF-8 with LF unless a file is first verified to require something else.
- Inspect encoding and newline state before editing files that contain Chinese or other non-ASCII text.
- Prefer minimal `apply_patch` edits. Avoid whole-file rewrites unless they are strictly necessary.
- Do not use PowerShell redirection, `Set-Content`, `Out-File`, or similar whole-file writes on non-ASCII files unless the file has been verified safe and the encoding is specified explicitly.
- If a file is invalid UTF-8 or its encoding is ambiguous, stop and ask instead of guessing.
- After text edits, verify the diff is localized and does not show whole-file mojibake or newline churn.
- Terminal mojibake alone is not proof that a file is corrupted. Validate with file bytes or `git diff`, not terminal display alone.

