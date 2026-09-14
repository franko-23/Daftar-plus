# Daftari+ Subscription System

Professional subscription architecture for Daftari+.

## Features
- Super Admin manages plans and pricing.
- Regular price + percentage discount + promotional price.
- Promotion start/end dates.
- Active/inactive plans.
- Owner sees current price and discount.
- Payment states: PENDING, SUCCESSFUL, FAILED.
- Each payment stores the exact amount charged.
- Subscription activates only after server-side payment confirmation.
- Expiry blocks business usage until renewal.
- PalmPesa credentials remain server-side in Render environment variables.

## Recommended environment variables
PALMPESA_API_TOKEN=
PALMPESA_USER_ID=
PALMPESA_BASE_URL=https://palmpesa.drmlelwa.co.tz

Do not commit secrets to GitHub.
