import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  categorize,
  formatKes,
  parseBatch,
  summarizeMonth,
  type StoredTransaction,
} from '@mpesa/core';
import { SAMPLE_SMS } from './src/sampleSms';

const MONTH = '2026-10';

export default function App() {
  const { txs, unparsedCount, summary } = useMemo(() => {
    const batch = parseBatch(SAMPLE_SMS);
    const stored: StoredTransaction[] = batch.parsed
      .map((t) => ({ ...t, category: categorize(t).category }))
      .sort((a, b) => b.ts.localeCompare(a.ts));
    return {
      txs: stored,
      unparsedCount: batch.unparsed.length,
      summary: summarizeMonth(stored, MONTH),
    };
  }, []);

  const maxCat = Math.max(1, ...summary.byCategory.map((c) => c.cents));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <StatusBar style="dark" />
      <Text style={s.title}>M-Pesa Manager</Text>
      <Text style={s.subtitle}>
        Demo data, parsed on this device by @mpesa/core · {MONTH}
      </Text>

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

      <Text style={s.h2}>Transactions</Text>
      {txs.map((t) => (
        <View key={t.id} style={s.txRow}>
          <View style={s.flex}>
            <Text style={s.txTitle}>{t.counterparty ?? t.type.replace('_', ' ')}</Text>
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
        {txs.length} transactions parsed · {unparsedCount} message
        {unparsedCount === 1 ? '' : 's'} kept for review
      </Text>
    </ScrollView>
  );
}

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
  footer: { textAlign: 'center', color: '#888', marginTop: 20, fontSize: 12 },
});