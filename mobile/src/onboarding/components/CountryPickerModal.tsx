import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { ThemeColors } from '../../contexts/ThemeContext';
import type { CountryOption } from '../data/countries';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (name: string) => void;
  countries: CountryOption[];
  selectedName: string;
  title: string;
  subtitle?: string;
  colors: ThemeColors;
}

export function CountryPickerModal({
  visible,
  onClose,
  onSelect,
  countries,
  selectedName,
  title,
  subtitle,
  colors,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return countries;
    return countries.filter(c => c.name.toLowerCase().includes(s));
  }, [countries, q]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('ONBOARDING.COUNTRY_MODAL.SEARCH_PLACEHOLDER')}
            placeholderTextColor={colors.textTertiary}
            style={[
              styles.search,
              { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.border },
            ]}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={item => item.name}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {t('ONBOARDING.COUNTRY_MODAL.NO_RESULTS')} “{q}”
            </Text>
          }
          renderItem={({ item }) => {
            const sel = item.name === selectedName;
            return (
              <Pressable
                onPress={() => {
                  onSelect(item.name);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.borderLight },
                  pressed && { backgroundColor: colors.overlay },
                  sel && { backgroundColor: colors.overlay },
                ]}
              >
                <Text style={styles.rowFlag}>{item.flag}</Text>
                <Text style={[styles.rowName, { color: colors.text }]}>{item.name}</Text>
                {sel && <Text style={{ color: colors.success, fontWeight: '700' }}>✓</Text>}
              </Pressable>
            );
          }}
        />
        <TouchableOpacity style={[styles.closeBtn, { marginBottom: insets.bottom + 12 }]} onPress={onClose} activeOpacity={0.7}>
          <Text style={[styles.closeBtnText, { color: colors.textSecondary }]}>{t('COMMON.CANCEL')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  sheetHeader: { paddingHorizontal: 20, marginBottom: 8 },
  sheetTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  sheetSub: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  search: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowFlag: { fontSize: 22, marginRight: 12 },
  rowName: { flex: 1, fontSize: 16 },
  empty: { textAlign: 'center', marginTop: 32, paddingHorizontal: 24, fontSize: 15 },
  closeBtn: { alignItems: 'center', paddingVertical: 12 },
  closeBtnText: { fontSize: 16, fontWeight: '500' },
});
