import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';

type Props = {
  visible: boolean;
  className?: string;
  submitting?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** When set, secondary CTA becomes “Reschedule instead?” and calls this (e.g. open availability). */
  onRescheduleInstead?: () => void;
};

const SCREEN_H = Dimensions.get('window').height;

export function ConfirmCancelClassModal({
  visible,
  className,
  submitting = false,
  onConfirm,
  onClose,
  onRescheduleInstead,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isDark = colors.isDark;

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      translateY.setValue(SCREEN_H);
      backdropOpacity.setValue(0);
    }
  }, [visible, translateY, backdropOpacity]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SCREEN_H,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [submitting, translateY, backdropOpacity, onClose]);

  const handleRescheduleInstead = useCallback(() => {
    if (submitting) return;
    if (onRescheduleInstead) {
      onRescheduleInstead();
      return;
    }
    handleClose();
  }, [submitting, onRescheduleInstead, handleClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.45)' },
            ]}
            onPress={handleClose}
          />
        </Animated.View>

        <View pointerEvents="box-none" style={styles.slot}>
          <Animated.View style={{ transform: [{ translateY }] }}>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.handleWrap}>
                <View
                  style={[
                    styles.handle,
                    { backgroundColor: isDark ? '#48484a' : '#d1d5db' },
                  ]}
                />
              </View>

              <View style={[styles.iconWrap, { backgroundColor: colors.danger + '1a' }]}>
                <Ionicons name="close-circle" size={34} color={colors.danger} />
              </View>

              <Text style={[styles.title, { color: colors.text }]}>
                {t('HOME.UP_NEXT_CANCEL_CLASS_TITLE')}
              </Text>

              {className ? (
                <Text style={[styles.className, { color: colors.textSecondary }]} numberOfLines={2}>
                  {className}
                </Text>
              ) : null}

              <Text style={[styles.message, { color: colors.textSecondary }]}>
                {t('HOME.UP_NEXT_CANCEL_CLASS_MSG')}
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={onConfirm}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.cta,
                  { backgroundColor: colors.danger },
                  pressed && { opacity: 0.85 },
                  submitting && { opacity: 0.55 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.ctaText}>
                    {t('HOME.UP_NEXT_CANCEL_CLASS_CONFIRM_CTA')}
                  </Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={handleRescheduleInstead}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.keep,
                  { backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7' },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.keepText, { color: colors.text }]}>
                  {onRescheduleInstead
                    ? t('HOME.UP_NEXT_RESCHEDULE_INSTEAD_CTA')
                    : t('HOME.UP_NEXT_CANCEL_CLASS_KEEP_CTA')}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1, justifyContent: 'flex-end' },
  card: {
    marginHorizontal: 12,
    marginBottom: 16,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 24,
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 18 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  iconWrap: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 6,
  },
  className: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  cta: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  keep: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
