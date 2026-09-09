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
export function sendFirebaseOtp(phoneE164, onAutoComplete) {
  return new Promise((resolve, reject) => {
    let settled = false
    let sentHandle
    let doneHandle
    let failHandle

    const removeAll = async () => {
      try { await sentHandle?.remove() } catch {}
      try { await doneHandle?.remove() } catch {}
      try { await failHandle?.remove() } catch {}
    }
    const finish = (fn, arg, keepListening = false) => {
      if (settled) return
      settled = true
      if (keepListening) fn(arg)
      else removeAll().finally(() => fn(arg))
    }

    FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
      // Resolve so the user can start typing, but deliberately keep listening:
      // on Android the SMS is very often auto-retrieved a moment later, which
      // completes the sign-in. Tearing the listeners down here meant that
      // completion went unheard while the plugin had already signed in, so the
      // code the user then typed was rejected and looked like a wrong OTP.
      finish(resolve, { verificationId: event.verificationId }, true)
    }).then((h) => { sentHandle = h })

    FirebaseAuthentication.addListener('phoneVerificationCompleted', async () => {
      // Android verified the number without the user typing anything.
      try {
        const { token } = await FirebaseAuthentication.getIdToken()
        if (settled) onAutoComplete?.(token)          // arrived after the code was sent
        else finish(resolve, { autoIdToken: token })  // instant verification
      } catch (err) {
        if (!settled) finish(reject, err)
      } finally {
        if (settled) removeAll()
      }
    }).then((h) => { doneHandle = h })

    FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
      if (settled) return
      finish(reject, new Error(event?.message || 'Phone verification failed'))
    }).then((h) => { failHandle = h })

    // Clear any residual Firebase session before starting. The confirm step
    // below treats "already signed in" as success, so a leftover session from a
    // previous attempt must never be able to stand in for a correct code.
    FirebaseAuthentication.signOut()
      .catch(() => {})
      .then(() => FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: phoneE164 }))
      .catch((err) => finish(reject, err))
  })
}

/**
 * Confirms the 6-digit code the user typed and returns a Firebase ID token.
 *
 * If Android already auto-verified in the background, confirming again fails
 * even though the user is signed in and their code was correct. So a failure is
 * only treated as a failure once we have checked there is no session — that
 * check is what stops a correct code being reported as wrong.
 */
export async function confirmFirebaseOtp(verificationId, code, phoneE164) {
  try {
    await FirebaseAuthentication.confirmVerificationCode({ verificationId, verificationCode: code })
  } catch (err) {
    // Accept only a session Android created for *this* number during *this*
    // attempt. Anything else and the original error stands, so a wrong code can
    // never be waved through by a stale sign-in.
    const { user } = await FirebaseAuthentication.getCurrentUser().catch(() => ({ user: null }))
    const digits = (value) => String(value || '').replace(/\D/g, '')
    const sameNumber = user && digits(user.phoneNumber).slice(-10) === digits(phoneE164).slice(-10)
    if (!sameNumber) throw err
  }
  const { token } = await FirebaseAuthentication.getIdToken()
  return token
}

/** Clears the native Firebase session (used on logout). */
export async function firebaseSignOut() {
  try { await FirebaseAuthentication.signOut() } catch {}
}
