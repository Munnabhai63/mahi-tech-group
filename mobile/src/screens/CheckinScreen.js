import React from 'react';
const { useState } = React;
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { colors } from '../constants/colors.js';
import { okrApi } from '../api/okr.api.js';
import { enqueueOfflineAction, ActionTypes } from '../utils/offlineQueue.js';
import * as Haptics from 'expo-haptics';

export const CheckinScreen = ({
  krId = 'kr-default',
  krTitle = 'Key Result Progress Check-in',
  targetValue = 100,
  currentValue: initialValue = 50,
  isOnline = true,
  onCheckinSuccess = null
}) => {
  const [currentValue, setCurrentValue] = useState(String(initialValue));
  const [confidence, setConfidence] = useState('0.8');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const handleSubmit = async () => {
    const numericValue = parseFloat(currentValue);
    const numericConfidence = parseFloat(confidence);

    if (isNaN(numericValue)) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid numeric progress value.' });
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);

    const payload = {
      krId,
      currentValue: numericValue,
      confidence: isNaN(numericConfidence) ? 0.8 : numericConfidence,
      note: note.trim()
    };

    if (!isOnline) {
      // Offline fallback queue
      const queuedItem = enqueueOfflineAction({
        type: ActionTypes.OKR_CHECKIN,
        payload
      });

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}

      setStatusMessage({
        type: 'success',
        text: 'Offline — Check-in queued and will sync automatically when reconnected.'
      });
      setSubmitting(false);
      onCheckinSuccess?.({ queued: true, item: queuedItem, payload });
      return { success: true, queued: true };
    }

    try {
      await okrApi.submitCheckin({
        kr_id: krId,
        current_value: numericValue,
        confidence: numericConfidence,
        note: note.trim()
      });

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}

      setStatusMessage({ type: 'success', text: 'Check-in submitted successfully!' });
      onCheckinSuccess?.({ success: true, payload });
      return { success: true };
    } catch (err) {
      // Network drop fallback
      const queuedItem = enqueueOfflineAction({
        type: ActionTypes.OKR_CHECKIN,
        payload
      });

      setStatusMessage({
        type: 'warning',
        text: 'Network error — Check-in saved to offline queue.'
      });
      onCheckinSuccess?.({ queued: true, item: queuedItem, payload });
      return { success: true, queued: true };
    } finally {
      setSubmitting(false);
    }
  };

  return React.createElement(
    ScrollView,
    { style: styles.container },
    React.createElement(Text, { style: styles.header }, 'OKR Check-in'),
    React.createElement(
      View,
      { style: styles.card },
      React.createElement(Text, { style: styles.krTitle }, krTitle),
      React.createElement(
        Text,
        { style: styles.targetSub },
        `Target: ${targetValue} units`
      ),

      // Progress Input
      React.createElement(Text, { style: styles.inputLabel }, 'Current Progress Value'),
      React.createElement(TextInput, {
        style: styles.input,
        keyboardType: 'numeric',
        value: currentValue,
        onChangeText: setCurrentValue,
        placeholder: 'e.g. 75',
        placeholderTextColor: '#64748b'
      }),

      // Confidence Selector
      React.createElement(Text, { style: styles.inputLabel }, 'Confidence Level'),
      React.createElement(
        View,
        { style: styles.confidenceRow },
        [
          { label: 'High (0.9)', value: '0.9' },
          { label: 'Medium (0.6)', value: '0.6' },
          { label: 'Low (0.3)', value: '0.3' }
        ].map((c) =>
          React.createElement(
            TouchableOpacity,
            {
              key: c.value,
              style: [
                styles.confidenceButton,
                confidence === c.value && styles.activeConfidenceButton
              ],
              onPress: () => setConfidence(c.value)
            },
            React.createElement(
              Text,
              {
                style: [
                  styles.confidenceText,
                  confidence === c.value && styles.activeConfidenceText
                ]
              },
              c.label
            )
          )
        )
      ),

      // Notes
      React.createElement(Text, { style: styles.inputLabel }, 'Progress Note / Blocker Comments'),
      React.createElement(TextInput, {
        style: [styles.input, styles.textArea],
        multiline: true,
        numberOfLines: 3,
        value: note,
        onChangeText: setNote,
        placeholder: 'Describe key deliverables completed this cycle...',
        placeholderTextColor: '#64748b'
      }),

      // Status Feedback
      statusMessage &&
        React.createElement(
          View,
          {
            style: [
              styles.feedbackBox,
              {
                backgroundColor:
                  statusMessage.type === 'error'
                    ? '#7f1d1d'
                    : statusMessage.type === 'warning'
                    ? '#78350f'
                    : '#064e3b'
              }
            ]
          },
          React.createElement(Text, { style: styles.feedbackText }, statusMessage.text)
        ),

      // Submit Button
      React.createElement(
        TouchableOpacity,
        {
          style: [styles.submitButton, submitting && { opacity: 0.6 }],
          disabled: submitting,
          onPress: handleSubmit
        },
        React.createElement(
          Text,
          { style: styles.submitText },
          submitting ? 'Submitting...' : 'Submit Check-in'
        )
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    padding: 16
  },
  header: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  krTitle: {
    color: DARK_ACCENT,
    fontSize: 16,
    fontWeight: '700'
  },
  targetSub: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 16,
    marginTop: 2
  },
  inputLabel: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10
  },
  input: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    color: '#f8fafc',
    padding: 12,
    fontSize: 14
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top'
  },
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  confidenceButton: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 3
  },
  activeConfidenceButton: {
    backgroundColor: DARK_ACCENT,
    borderColor: DARK_ACCENT
  },
  confidenceText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600'
  },
  activeConfidenceText: {
    color: '#0f172a',
    fontWeight: '700'
  },
  feedbackBox: {
    padding: 10,
    borderRadius: 6,
    marginTop: 14
  },
  feedbackText: {
    color: '#f8fafc',
    fontSize: 12
  },
  submitButton: {
    backgroundColor: DARK_ACCENT,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20
  },
  submitText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default CheckinScreen;
