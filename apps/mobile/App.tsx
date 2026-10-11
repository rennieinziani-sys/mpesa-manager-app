import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  categorize,
  type InboxMessage,
  formatKes,
  parseBatch,
  summarizeMonth,
  type StoredTransaction,
} from '@mpesa/core';
import { SAMPLE_SMS } from './src/sampleSms';

/** Split pasted text into messages: a blank line separates messages. */
function splitMessages(text: string): InboxMessage[] {
  const receivedAt = new Date().toISOString();
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((body) => ({ body, receivedAt }));
}

export default function App() {
  const [messages, setMessages] = useState<InboxMessage[]>(SAMPLE_SMS);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [month, setMonth] = useState<string | null>(null);

  const { txs, unparsedCount, duplicates, months } = useMemo(() => {
    const batch = parseBatch(messages);
    const stored: StoredTransaction[] = batch.parsed
      .map((t) => ({ ...t, category: categorize(t).category }))
      .sort((a, b) => b.ts.localeCompare(a.ts));
    const ms = [...new Set(stored.map((t) => t.ts.slice(0, 7)))];
    return { txs: stored, unparsedCount: batch.unparsed.length, duplicates: batch.duplicates, months: ms };
  }, [messages]);

  const MONTH = month && months.includes(month) ? month : (months[0] ?? new Date().toISOString().slice(0, 7));
  const summary = useMemo(() => summarizeMonth(txs, MONTH), [txs, MONTH]);
  const shown = txs.filter((t) => t.ts.startsWith(MONTH));

  const addMessages = () => {
    const incoming = splitMessages(draft);
    if (!incoming.length) return;
    const before = parseBatch(messages).parsed.length;
    const after = parseBatch([...messages, ...incoming]).parsed.length;
    setMessages([...messages, ...incoming]);
    setDraft('');
    setNote(`Added ${after - before} new transaction${after - before === 1 ? '' : 's'} from ${incoming.length} message${incoming.length === 1 ? '' : 's'}.`);
  };

  const maxCat = Math.max(1, ...summary.byCategory.map((c) => c.cents));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <StatusBar style="dark" />
      <Text style={s.title}>M-Pesa Manager</Text>
      <Text style={s.subtitle}>
        Parsed on this device by @mpesa/core · {MONTH}
      </Text>

      {months.length > 1 && (
        <View style={s.months}>
          {months.map((m) => (
            <Pressable key={m} onPress={() => setMonth(m)} style={[s.chip, m === MONTH && s.chipOn]}>
              <Text style={m === MONTH && s.chipTextOn}>{m}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={s.cards}>
        <Card label="Income" value={formatKes(summary.incomeCents)} />
        <Card label="Spent" value={formatKes(summary.spendCents)} />
        <Card label="Fees paid" value={formatKes(summary.feesCents)} />
        <Card label="Fuliza drawn" value={formatKes(summary.fulizaBorrowedCents)} />
      </View>

      <Text style={s.h2}>Spending by category</Text>
      {summary.byCategory.map((c) => (
        <View key={c.category} style={s.catBlock}>
          <View style={s.rowBetween}>
            <Text>{c.category}</Text>
            <Text>{formatKes(c.cents)}</Text>
          </View>
          <View style={s.barBg}>
            <View style={[s.bar, { width: `${(c.cents / maxCat) * 100}%` }]} />
          </View>
        </View>
      ))}

      <Text style={s.h2}>Add messages</Text>
      <TextInput
        style={s.input}
        multiline
        value={draft}
        onChangeText={setDraft}
        placeholder="Paste M-Pesa SMS here (separate messages with a blank line)"
      />
      <Pressable onPress={addMessages} style={s.button}>
        <Text style={s.buttonText}>Add</Text>
      </Pressable>
      {note !== '' && <Text style={s.note}>{note}</Text>}

      <Text style={s.h2}>Transactions</Text>
      {shown.map((t) => (
        <View key={t.id} style={s.txRow}>
          <View style={s.flex}>
            <Text style={s.txTitle}>{t.counterparty ?? LABELS[t.type] ?? t.type}</Text>
            <Text style={s.txSub}>
              {t.ts.slice(0, 10)} · {t.category ?? 'Uncategorised'}
              {t.feeCents ? ` · fee ${formatKes(t.feeCents)}` : ''}
            </Text>
          </View>
          <Text style={[s.amount, t.direction === 'in' && s.amountIn]}>
            {t.direction === 'in' ? '+' : t.direction === 'out' ? '-' : ''}
            {formatKes(t.amountCents)}
          </Text>
        </View>
      ))}

      <Text style={s.footer}>
        {txs.length} transactions parsed · {duplicates} duplicate{duplicates === 1 ? '' : 's'} skipped · {unparsedCount} message
        {unparsedCount === 1 ? '' : 's'} not recognised
      </Text>
    </ScrollView>
  );
}

const LABELS: Record<string, string> = {
  airtime: 'Airtime',
  fuliza_draw: 'Fuliza loan',
  fuliza_repay: 'Fuliza repayment',
  withdraw: 'Cash withdrawal',
  deposit: 'Cash deposit',
  reversal: 'Reversal',
};

function Card({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={s.cardValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fafafa' },
  content: { padding: 16, paddingTop: 56, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#666', marginTop: 4, marginBottom: 16 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexGrow: 1, flexBasis: '45%', backgroundColor: '#fff', padding: 12, borderRadius: 10 },
  cardLabel: { color: '#777', fontSize: 12 },
  cardValue: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  h2: { fontSize: 15, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  catBlock: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barBg: { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3 },
  bar: { height: 6, backgroundColor: '#2E7D32', borderRadius: 3 },
  txRow: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
  },
  flex: { flex: 1 },
  txTitle: { fontSize: 15, fontWeight: '500' },
  txSub: { fontSize: 12, color: '#777', marginTop: 2 },
  amount: { fontSize: 15 },
  amountIn: { color: '#2E7D32' },
  months: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#e8e8e8' },
  chipOn: { backgroundColor: '#2E7D32' },
  chipTextOn: { color: '#fff' },
  input: { minHeight: 90, backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#ddd' },
  button: { marginTop: 8, backgroundColor: '#2E7D32', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  note: { marginTop: 6, color: '#555', fontSize: 12 },
  footer: { textAlign: 'center', color: '#888', marginTop: 20, fontSize: 12 },
});