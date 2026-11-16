# ResQ Wheels

ResQ Wheels connects customers with registered roadside service providers. It includes customer, provider, and administrator views, provider registration, location-based search, emergency requests, bookings, and booking-status tracking.

Providers appear in search after they create an account and register a service center. Customers can pay providers directly using the provider's registered UPI ID; ResQ Wheels does not collect customer payments.

## Requirements and local run

- Node.js 22.5 or newer (`node:sqlite` is used by the server).
- An internet connection for hosted fonts, Leaflet, OpenStreetMap tiles, and typed-address geocoding.

Start the server in PowerShell:

```powershell
npm.cmd start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` before startup to use another port.

## Accounts

- Customers and service providers can register from the sign-in screen. Passwords must be 10-128 characters; provider sign-up also requires a phone number.
- Providers register a service center with its UPI ID, contact phone, service category, price, address, and map location. Customers see providers within 20 km of their shared location. Providers can update their pin, pause availability, or unregister from the provider portal; unregistration is blocked while the provider has an active booking.
- While a provider marks a booking en route, their GPS position is shared with that booking's customer and refreshed on the tracking map. Sharing stops when the provider marks arrival; GPS permission must be allowed in the provider's browser or device.
- Administrators cannot sign up publicly. On a fresh database, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before starting the server:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "use-a-unique-secret-at-least-12-characters"
npm.cmd start
```

Administrator passwords must be 12-128 characters. Keep credentials out of source control and use a secrets manager in production. Supplying the same administrator email and a new password on a later startup resets that account's password.

## Virtual commission credits

Credits are virtual commission accounting units, not cash, stored value, or withdrawable funds. Providers cannot withdraw or transfer credits.

- Providers transfer at least **Rs 200** to the admin UPI ID shown in the provider portal, then submit the UTR/reference number and a JPEG, PNG, or WebP screenshot (up to 3 MB).
- An administrator checks the receipt and manually approves or rejects the deposit. An approved deposit adds the exact same number of credits (Rs 1 = 1 credit). UTRs can only be submitted once.
- The default commission is **6%** of the final booking total (including the existing platform fee and GST). The rate and admin UPI ID can be changed in the administrator's credit-management section. Each booking snapshots the rate when created.
- At provider acceptance, the estimated commission is reserved from available credits. The reservation is released if the booking is cancelled. Successful OTP completion deducts the reserved commission and records it in the provider's credit ledger.
- A provider cannot accept direct bookings or emergency quotes without a valid UPI ID and enough available credits. Accepted work that is later cancelled releases its reserve.
- Customers pay the provider's UPI ID directly for the displayed booking total. The website does not collect, verify, split, or refund these customer payments.
- Administrators can review deposits, manually adjust a provider's balance with a recorded reason, view transaction history, and change the commission rate. Provider and administrator dashboards label balances as virtual credits.

The default admin UPI ID is `kolwalerohan8-2@oksbi`. Administrators can update it from the credit-management section.

## Data storage

The SQLite database defaults to `resq-wheels.sqlite` in the project directory. It stores accounts, sessions, provider profiles, credit balances, deposits (including proof images), credit transactions, and pricing settings. Protect database files and backups because they contain personal details and payment receipts.

Set `AUTH_DB_PATH` to use another writable SQLite file:

```powershell
$env:AUTH_DB_PATH = "C:\ResQ\data\resq-wheels.sqlite"
npm.cmd start
```

Bookings and emergency requests are currently held in server memory and are lost when the server restarts. Add durable booking storage and test database backups before public launch.

## Validation

Run syntax checks and the focused test suite:

```powershell
npm.cmd test
```

## Before a public launch

- Serve the app over HTTPS and set `NODE_ENV=production` so session cookies use the `Secure` attribute. The built-in server uses HTTP; terminate HTTPS at a properly configured reverse proxy or hosting platform.
- Persist bookings, emergencies, and operational totals in durable storage; create and test database backups.
- Add and test account recovery and email/phone verification, and publish privacy, provider, cancellation, and refund terms.
- Review fees and GST treatment with a tax professional; verify provider identity, permits, and service-area details.
- Check the usage terms and rate limits for the external mapping, geocoding, font, and tile services before production traffic.

## Customer support

The website's WhatsApp support link uses **+91 94048 19359**.
