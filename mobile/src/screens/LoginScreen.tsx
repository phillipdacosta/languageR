import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    setSubmitting(true);
    try { await login(); }
    catch (err: any) { if (err?.message?.includes('cancelled')) return; Alert.alert(t('LOGIN.TITLE'), err.message || t('COMMON.LOADING')); }
    finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.logo, { color: colors.text }]}>Barnabi</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('LOGIN.SUBTITLE')}</Text>
        </View>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.accent }, submitting && styles.buttonDisabled]} onPress={handleLogin} disabled={submitting} activeOpacity={0.8}>
          {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={[styles.buttonText, { color: colors.background }]}>{t('LOGIN.SIGN_IN')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={[styles.footer, { color: colors.textSecondary }]}>{t('LOGIN.SIGN_UP')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  header: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 38, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, marginTop: 8 },
  button: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  footer: { textAlign: 'center', marginTop: 32, fontSize: 14 },
});
