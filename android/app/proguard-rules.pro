# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- Capacitor / WebView bridge keeps (required when minifyEnabled=true) ---
# Capacitor discovers plugins and bridges JS<->native via reflection and
# @JavascriptInterface methods; R8 must not rename or remove them.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
  @android.webkit.JavascriptInterface <methods>;
}
-keep class com.milkymart.clone.** { *; }
-dontwarn com.getcapacitor.**

# --- Firebase Authentication plugin (phone-only) ---
# The plugin ships handlers for Facebook / Google / credential providers we don't
# bundle (only "phone" is enabled). R8 sees those optional references as missing
# classes; silence them so minification succeeds. Firebase Auth itself is kept.
-keep class com.google.firebase.auth.** { *; }
-dontwarn com.facebook.**
-dontwarn com.google.android.gms.**
-dontwarn com.google.android.libraries.identity.googleid.**
-dontwarn androidx.credentials.**
