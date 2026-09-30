# Milky Mart — Local Web Clone

A responsive, mobile-first recreation of the supplied **Milky Mart 3.0.0** Android APK. The interface uses the visual assets and product imagery recovered from the APK, while all customer, rider, cart, checkout, wallet, order, profile and notification interactions run locally with demo data.

## Download & links

- **Android app (latest APK):** https://github.com/VijayabaskarR-06/milkymart-backend/releases/latest/download/MilkyMart.apk
- **All app releases:** https://github.com/VijayabaskarR-06/milkymart-backend/releases
- **API:** https://milkymart-daily-api.onrender.com
- **Admin panel:** https://milkymart-daily-api.onrender.com/admin/
- **App code:** https://github.com/VijayabaskarR-06/milkymart-app
- **Backend code:** https://github.com/VijayabaskarR-06/milkymart-backend

## Included flows

- Customer and delivery-partner role selection
- Phone login and demo OTP verification
- Product search, product details, cart and quantity controls
- Address, schedule and payment selection at checkout
- Active orders, order history, wallet and notifications
- Customer profile, subscriptions and saved-address placeholders
- Rider dashboard, delivery states, earnings and verified KYC profile
- Mobile-first layout with a centred phone frame on desktop
- Browser local storage for cart, orders and delivery progress

The verified production output is also included in `dist/`.

## Run on localhost

You need Node.js 22 or newer (the Capacitor 8 CLI requires it).

```bash
npm install
npm run dev
```

Open the URL shown by Vite, normally <http://localhost:5173>.

For a production build:

```bash
npm run build
npm run preview
```

## Android builds

`npm run preflight` checks the two things that silently break an Android build:
Node must be 22+, and the JDK must be 17-21 (Android Gradle Plugin 8.7 rejects
newer ones). Every APK/AAB script runs it first.

```bash
npm run apk          # debug APK
npm run apk:release  # signed release APK
npm run aab:release  # signed release bundle for Play
```

Release builds need `android/keystore.properties` (gitignored) pointing at the
signing keystore; without it the build stops rather than emitting an unsigned
artifact. `versionCode`/`versionName` come from the `version` in `package.json`
(1.2.3 becomes versionCode 10203), so bump that to ship an update.

## Demo login

- Select **Customer** or **Delivery partner**.
- Enter any valid-looking 10-digit phone number.
- Enter any 6-digit OTP, or use `123456`.

The app stores the selected role, cart and new orders in the browser's local storage. Use **Reset demo** on the profile screen to clear local state.

## Scope and safety

An Android release APK contains compiled Flutter code, not the original editable Dart project. This repository is therefore a clean-room web recreation, not the original source repository. It intentionally does not include production API keys, Firebase credentials, user records, or a connection to the private live backend. Replace the local data layer in `src/data.js` with your own authorised API when you are ready.
