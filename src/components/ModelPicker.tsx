import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

/** The provider's models to pick from: OpenRouter alone lists hundreds, so it filters as you type. */
export function ModelPicker({ visible, models, value, onPick, onClose }: {
  visible: boolean; models: string[]; value: string; onPick: (id: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => words.every((w) => m.toLowerCase().includes(w)));
  }, [models, q]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: t.colors.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: t.colors.text }]}>Model</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.done}>
            <Text style={[styles.doneText, { color: t.colors.accent }]}>Cancel</Text>
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <Ionicons name="search" size={17} color={t.colors.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={`Filter ${models.length} models`}
            placeholderTextColor={t.colors.textMuted}
            selectionColor={t.colors.accent}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchText, { color: t.colors.text }]}
            accessibilityLabel="Filter models"
          />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(m) => m}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: item === value }}
              onPress={() => { onPick(item); onClose(); }}
              style={({ pressed }) => [styles.row, { borderBottomColor: t.colors.border }, pressed && { backgroundColor: t.colors.surface }]}
            >
              <Text numberOfLines={1} style={[styles.rowText, { color: t.colors.text }]}>{item}</Text>
              {item === value ? <Ionicons name="checkmark" size={20} color={t.name === 'dark' ? t.colors.volt : t.colors.accent} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { height: 56, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  done: { position: 'absolute', right: 16, height: 44, justifyContent: 'center' },
  doneText: { fontSize: 17, fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  searchText: { flex: 1, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, fontSize: 16 },
});
