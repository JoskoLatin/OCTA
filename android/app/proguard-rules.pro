# ── OCTA — R8 rules ───────────────────────────────────────────────────────
# Minification is on so the App Bundle carries a deobfuscation map (Play warns
# when one is missing). Capacitor wires the web layer to Java by reflection,
# so the pieces it looks up by name have to survive renaming.

# The bridge itself, plus anything it exposes to JavaScript.
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }

# Plugins are discovered from capacitor.plugins.json by class name, and their
# methods are called from JS — neither may be renamed or stripped.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
  @com.getcapacitor.PluginMethod public *;
  @android.webkit.JavascriptInterface public *;
}

# The app's own activity is named in AndroidManifest.xml.
-keep class com.vodice.octa.** { *; }

# Keep line numbers so Play's crash reports stay readable, while still
# hiding the original source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
