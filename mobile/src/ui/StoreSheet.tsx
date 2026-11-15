import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buy, closePanel, useGame } from '../game/store';
import { OFFERS, PLANS, type OfferId } from '../../shared/plans';
import { colors, fonts, space } from './theme';

const monthly = OFFERS.patron_monthly.priceUsd;
const annual = OFFERS.patron_annual.priceUsd;
const annualSaving = Math.round((1 - annual / (monthly * 12)) * 100);

function OfferRow({ offer, note, disabled }: { offer: OfferId; note: string; disabled: boolean }) {
  const o = OFFERS[offer];
  const price = '$' + o.priceUsd + (o.kind === 'patron' ? (o.billingPeriodDays >= 365 ? '/yr' : '/mo') : '');
  return (
    <Pressable style={[styles.row, disabled && styles.rowDisabled]} onPress={() => buy(offer)} disabled={disabled}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{o.title}</Text>
        <Text style={styles.rowNote}>{note}</Text>
      </View>
      <Text style={styles.price}>{price}</Text>
    </Pressable>
  );
}

export function StoreSheet() {
  const patron = useGame((s) => s.plan === 'patron');
  const checkingOut = useGame((s) => s.checkingOut);
  const llm = useGame((s) => s.world?.llm);
  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>{patron ? 'Patron' : 'Become a Patron'}</Text>
        <Pressable onPress={closePanel} hitSlop={12}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>
      {llm ? (
        <Text style={styles.budget}>
          Thoughts today {llm.callsToday}/{llm.budgetPerDay}
          {llm.bonusThoughts > 0 ? ' · ' + llm.bonusThoughts + ' banked' : ''}
        </Text>
      ) : null}
      {patron ? null : (
        <>
          <Text style={styles.pitch}>
            {PLANS.patron.thoughtsPerDay} colonist thoughts a day instead of {PLANS.free.thoughtsPerDay}. More worlds, a bigger town and offline catch-up as they ship.
          </Text>
          <OfferRow offer="patron_monthly" note="Cancel anytime" disabled={checkingOut} />
          <OfferRow offer="patron_annual" note={'Save ' + annualSaving + '%'} disabled={checkingOut} />
        </>
      )}
      <OfferRow offer="thoughts_100" note="One-time. Used after today's budget runs out, never expire." disabled={checkingOut} />
      {checkingOut ? <Text style={styles.rowNote}>Opening checkout…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.xl,
    padding: space.lg,
    gap: space.sm,
    backgroundColor: colors.panel,
    borderWidth: 2,
    borderColor: colors.gold,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.gold, fontFamily: fonts.labelBold, fontSize: 16 },
  close: { color: colors.textDim, fontFamily: fonts.label, fontSize: 20 },
  budget: { color: colors.accent, fontFamily: fonts.label, fontSize: 11 },
  pitch: { color: colors.text, fontFamily: fonts.body, fontSize: 14, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.panelHi,
    borderWidth: 2,
    borderColor: colors.border,
  },
  rowDisabled: { opacity: 0.5 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontFamily: fonts.label, fontSize: 13 },
  rowNote: { color: colors.textDim, fontFamily: fonts.body, fontSize: 12 },
  price: { color: colors.gold, fontFamily: fonts.label, fontSize: 13 },
});
