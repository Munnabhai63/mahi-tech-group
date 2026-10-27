# Security Policy

## Supported Versions

The following versions of **MAHI TECH GROUP Platform** are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security and integrity of the **MAHI TECH GROUP** decentralized platform extremely seriously.

If you believe you have discovered a security vulnerability in this repository:
1. **DO NOT** create a public GitHub Issue.
2. Email the system administrator directly at: `admin@mahitechgroup.com` or `dev@mahitechgroup.local`.
3. Provide detailed steps to reproduce the vulnerability, including request headers, affected endpoints, and payload examples.
4. You will receive an acknowledgment within 24 hours. Valid security reports will be patched immediately and credited appropriately.

## Security Practices
- Real-time immutable audit trail via `access_log` and `github_webhook_log`.
- Zero raw secrets or private tokens in source code or client bundles.
- AES-256-GCM encryption for API keys and sensitive credentials.
- Append-only financial ledgers and cryptographically verified digital signatures.
