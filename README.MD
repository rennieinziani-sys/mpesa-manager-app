# M-Pesa Manager

A local-first money manager for M-Pesa. It turns M-Pesa SMS messages into categorised transactions, budgets, month-end forecasts and recurring-bill detection. Data stays on your device.

## What it does

- Parses real M-Pesa messages: received, sent, paybill, till, withdrawals, airtime, reversals and Fuliza loans, repayments and fees.
- Stores money as integer cents, with EAT timestamps and the transaction code as the unique key.
- Categorises transactions with whole-word merchant rules. Correct one transaction and the app learns the payee.
- Shows monthly summaries, budget progress, a spend forecast with a range, recurring payments and how long your balance lasts.
- Keeps messages it cannot read in a review list instead of dropping them.

## How it is built

- packages/core is platform-neutral TypeScript: parser, categoriser, analytics and a small database port. It has its own Jest test suite.
- apps/mobile is an Expo / React Native app. On Android and iOS it stores data in on-device SQLite; on the web/PC build it keeps data in the browser.
- The database port lets the same repository code run on SQLite in the app and on sql.js in the tests.

## Limits, stated plainly

- M-Pesa has no public API for a personal account (Daraja is for businesses), so the live feed comes from SMS. Reading SMS automatically is possible on Android only; iOS and desktop will use statement import.
- The Android SMS reader and statement import are not built yet.

## Run it

Requires Node 22 and, on Windows, the Microsoft Visual C++ Redistributable.

    npm install
    npm test
    cd apps/mobile
    npx expo start --web

## Roadmap

- Android SMS reader (native module)
- M-Pesa statement import (PDF/CSV) for iOS and desktop
- Encrypted database and app lock
- CSV export