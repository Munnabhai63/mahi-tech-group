// Encrypted MMKV Local Storage Wrapper (Zero Plaintext, Zero AsyncStorage)
import { MMKV } from 'react-native-mmkv';

export const ENCRYPTION_KEY = process.env.MMKV_ENCRYPTION_KEY || 'mtg-sec-key-32-bytes-auth-token-salt';

export const mmkvInstance = new MMKV({
  id: 'mtg-encrypted-storage',
  encryptionKey: ENCRYPTION_KEY
});

export const secureStorage = {
  isEncrypted: () => Boolean(mmkvInstance.encryptionKey || ENCRYPTION_KEY),
  rawInstance: () => mmkvInstance,

  set: (key, value) => {
    if (value === undefined || value === null) {
      mmkvInstance.delete(key);
      return;
    }
    mmkvInstance.set(key, String(value));
  },

  getString: (key) => {
    return mmkvInstance.getString(key) ?? null;
  },

  setObject: (key, value) => {
    const jsonStr = JSON.stringify(value);
    mmkvInstance.set(key, jsonStr);
  },

  getObject: (key) => {
    const val = mmkvInstance.getString(key);
    if (!val) return null;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  },

  getNumber: (key) => {
    return mmkvInstance.getNumber(key);
  },

  getBoolean: (key) => {
    return mmkvInstance.getBoolean(key);
  },

  contains: (key) => {
    return mmkvInstance.contains(key);
  },

  delete: (key) => {
    return mmkvInstance.delete(key);
  },

  clearAll: () => {
    return mmkvInstance.clearAll();
  },

  getAllKeys: () => {
    return mmkvInstance.getAllKeys();
  }
};

export default secureStorage;
