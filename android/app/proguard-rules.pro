# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Backup format (Phase 6, TZBK v1): BouncyCastle's lightweight API (Argon2id, HKDF).
# These classes are referenced directly, never by reflection, so R8 keeps them anyway;
# the rules make that explicit should release shrinking be enabled.
-keep class org.bouncycastle.crypto.generators.Argon2BytesGenerator { *; }
-keep class org.bouncycastle.crypto.generators.HKDFBytesGenerator { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters$Builder { *; }
-keep class org.bouncycastle.crypto.params.HKDFParameters { *; }
-keep class org.bouncycastle.crypto.digests.SHA256Digest { *; }
