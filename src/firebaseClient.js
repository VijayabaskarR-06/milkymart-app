// Firebase phone-number sign-in for the native Android app.
//
// The @capacitor-firebase/authentication plugin drives Google's native phone
// verification (SMS + Play Integrity + instant auto-retrieval), then we hand the
// resulting Firebase ID token to our backend (`POST /api/auth/firebase`), which
// verifies it and issues a Milky Mart session. All of this runs natively, so the
// Firebase JS SDK is not needed here — the plugin returns the ID token directly.
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'

// Phone auth only works inside the native app (needs Google Play services + the
// SHA-1-registered signing key). On the web preview we fall back to backend OTP.
export const canUseFirebasePhone = Capacitor.isNativePlatform()

/**
 * Starts phone verification and sends the SMS.
 * Resolves with { verificationId } once the code is sent, or { autoIdToken }
 * when Android completes verification automatically (instant verification).
 */
export function sendFirebaseOtp(phoneE164) {
  return new Promise((resolve, reject) => {
    let settled = false
    let sentHandle
    let doneHandle
    let failHandle

    const cleanup = async () => {
      try { await sentHandle?.remove() } catch {}
      try { await doneHandle?.remove() } catch {}
      try { await failHandle?.remove() } catch {}
    }
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      cleanup().finally(() => fn(arg))
    }

    FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
      finish(resolve, { verificationId: event.verificationId })
    }).then((h) => { sentHandle = h })

    FirebaseAuthentication.addListener('phoneVerificationCompleted', async () => {
      // Instant verification: the plugin is already signed in — grab the token.
      try {
        const { token } = await FirebaseAuthentication.getIdToken()
        finish(resolve, { autoIdToken: token })
      } catch (err) {
        finish(reject, err)
      }
    }).then((h) => { doneHandle = h })

    FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
      finish(reject, new Error(event?.message || 'Phone verification failed'))
    }).then((h) => { failHandle = h })

    FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: phoneE164 })
      .catch((err) => finish(reject, err))
  })
}

/**
 * Confirms the 6-digit code the user typed and returns a Firebase ID token.
 */
export async function confirmFirebaseOtp(verificationId, code) {
  await FirebaseAuthentication.confirmVerificationCode({ verificationId, verificationCode: code })
  const { token } = await FirebaseAuthentication.getIdToken()
  return token
}

/** Clears the native Firebase session (used on logout). */
export async function firebaseSignOut() {
  try { await FirebaseAuthentication.signOut() } catch {}
}
