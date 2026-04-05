# Citadel

Backend for the Mode Labs execution system: the Discord bot **Richard**, wired to Firebase for persistence and coordination.

## Overview

- **One bot (Richard)** — single operator surface across configured guilds.
- **Multi-guild** — guild registry, channels, and feature flags live in config; behavior stays consistent per server.
- **Execution domain** — sessions and an active-session loop: start, track, and close execution work with Discord-native IDs.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and open it for editing
3. Add Firebase credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` from a service account)
4. Run the bot or automation for your environment (`package.json` lists available scripts)

## Environment Variables

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Other processes may require additional variables; never commit real values.

## Structure (short)

- **`src/domains/`** — domain logic (e.g. execution sessions, repositories, services)
- **`src/infra/`** — Firebase Admin, Firestore, and other infrastructure adapters
- **`src/config/`** — guild registry, channels, feature flags

## Notes

- **Firebase Admin SDK only** — server-side credentials; no client SDK for privileged paths.
- **Discord-native identity** — users and sessions key off Discord snowflakes (`discordUserId`, `guildId`, `channelId`).
- **Execution loop focus** — design centers on session lifecycle and active-session invariants, not generic CRUD.
