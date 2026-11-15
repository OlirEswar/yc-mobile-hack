import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from 'convex/react';
import { anyApi } from 'convex/server';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, { unsavedChangesWarning: false });

function Items() {
  const items = useQuery(anyApi.items.list, {}) as { _id: string; text: string }[] | undefined;
  const addItem = useMutation(anyApi.items.add);
  const [text, setText] = useState('');

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    await addItem({ text: trimmed });
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Items</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="New item"
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="done"
        />
        <Pressable style={styles.button} onPress={submit}>
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>
      {items === undefined ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item._id}
          ListEmptyComponent={<Text style={styles.muted}>No items yet</Text>}
          renderItem={({ item }) => <Text style={styles.item}>{item.text}</Text>}
        />
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ConvexProvider client={convex}>
      <Items />
    </ConvexProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20 },
  title: { fontSize: 28, fontWeight: '700', marginTop: 16, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, height: 44 },
  button: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  item: { fontSize: 17, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  muted: { color: '#888' },
});
