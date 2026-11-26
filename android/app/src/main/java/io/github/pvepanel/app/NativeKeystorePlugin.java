package io.github.pvepanel.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Hardware-backed AndroidKeyStore AES-256-GCM credential storage plugin for Capacitor 8.
 * Encrypts server URLs, Bearer API tokens, and session JWTs before writing to private SharedPreferences.
 */
@CapacitorPlugin(name = "NativeKeystore")
public class NativeKeystorePlugin extends Plugin {

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "io.github.pvepanel.app.master_key_v1";
    private static final String PREFS_NAME = "pve_center_native_keystore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final Object LOCK = new Object();

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);

        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private String encryptValue(String plaintext) throws Exception {
        SecretKey secretKey = getOrCreateSecretKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();
        byte[] cipherBytes = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return (
            Base64.encodeToString(iv, Base64.NO_WRAP) +
            ":" +
            Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
        );
    }

    private String decryptValue(String encoded) {
        if (encoded == null || encoded.isEmpty()) {
            return null;
        }
        int sep = encoded.indexOf(':');
        if (sep <= 0) {
            return null;
        }
        try {
            byte[] iv = Base64.decode(encoded.substring(0, sep), Base64.NO_WRAP);
            byte[] cipherBytes = Base64.decode(encoded.substring(sep + 1), Base64.NO_WRAP);
            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] plainBytes = cipher.doFinal(cipherBytes);
            return new String(plainBytes, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return null;
        }
    }

    @PluginMethod
    public void getItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            synchronized (LOCK) {
                // Ensure AndroidKeyStore is usable even when probing an empty key.
                getOrCreateSecretKey();
                String stored = getPrefs().getString(key, null);
                String decrypted = decryptValue(stored);
                if (stored != null && decrypted == null) {
                    getPrefs().edit().remove(key).apply();
                }
                JSObject result = new JSObject();
                result.put("value", decrypted);
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("AndroidKeyStore read failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void setItem(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            synchronized (LOCK) {
                if (value == null || value.isEmpty()) {
                    getPrefs().edit().remove(key).apply();
                } else {
                    String encrypted = encryptValue(value);
                    getPrefs().edit().putString(key, encrypted).apply();
                }
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("AndroidKeyStore write failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void removeItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            synchronized (LOCK) {
                getPrefs().edit().remove(key).apply();
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("AndroidKeyStore remove failed: " + e.getMessage(), e);
        }
    }
}
