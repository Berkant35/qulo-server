import { randomUUID } from 'node:crypto';
import { supabase } from '../../config/supabase.js';
import { NotificationService } from '../notification.service.js';
import { resolveLocale } from '../../utils/locales.js';
import type { EngineConfig } from '../../validators/notification-engine.validator.js';
import { loadEngineConfig } from './config.js';
import { DECISION_WINDOW_MS, loadContext } from './context.js';
import type { EngineContext, EngineUser } from './context.js';
import { LIFECYCLE_RULES } from './rules.js';
import { sequenceProgress } from './sequence.js';
import type { LifecycleRule, RuleCategory, RuleMatch } from './rules.js';
import { DAY_MS, localHour, utcOffsetHours } from './timezone.js';
import { holdoutBucket, throttleReason } from './throttle.js';
import { appConfigService } from '../app-config.service.js';
import { matchRecallEmailService } from '../match-recall-email.service.js';

/**
 * Bildirim motoru — Faz 1, bilerek basit:
 *  kullanicinin yerel saati == gonderim saati → gunde tek karar → oncelik sirasinda ilk uyan kural
 *  → gunluk/haftalik tavan → holdout → tercih → sablon → gonder (veya dry-run) → push_log.
 *
 * mode 'live'     : cron. Pencere + "bugun karar verildi" kontrolleri calisir, her karar push_log'a yazilir.
 *                   config.dry_run=true ise gonderim yerine 'dry_run' karari kaydedilir.
 * mode 'simulate' : backoffice onizleme. Pencere/gunluk kontrol YOK, gonderim YOK, kayit YOK.
 *
 * Dayaniklilik: gercek gonderimde kayit ONCE atilir ('failed'/'in_flight'), sonra FCM, sonra kayit
 * guncellenir. Kayit atilamazsa gonderilmez. Boylece deploy ortasinda kesilen veya log'u dusen bir tur
 * ayni saat penceresindeki sonraki tiklerde ayni kullaniciya ikinci push atamaz.
 */
export type EngineMode = 'live' | 'simulate';
export type EffectiveMode = 'live' | 'dry_run' | 'simulate';
export type DecisionKind = 'sent' | 'dry_run' | 'suppressed' | 'holdout' | 'failed';

export interface EngineDecision {
  userId: string;
  userName: string;
  ruleKey: string;
  decision: DecisionKind;
  reason: string | null;
  locale: string;
  actionUrl: string;
  title: string | null;
  body: string | null;
  notificationId: string | null;
  /** Bu gonderimin kural dizisindeki sirasi (1'den). push_log payload'ina yazilir, sequence.ts oradan okur. */
  sequenceStep: number;
  /** Teslim kanali; yoksa push. E-posta yedegi (recall_email_enabled) 'email' yazar — payload.channel. */
  channel?: 'push' | 'email';
}

/**
 * Push token'i olmayan hedefe e-posta yedegi verilen kurallar. Yalniz "seni cozduler": e-posta pahali
 * bir kanal (gonderici itibari, abonelikten cikma) — her yasam dongusu durtmesi icin degil.
 */
export const EMAIL_FALLBACK_RULE_KEYS: ReadonlySet<string> = new Set(['lifecycle_solved_waiting']);

export interface EngineRunResult {
  runId: string;
  mode: EffectiveMode;
  enabled: boolean;
  tableMissing: boolean;
  evaluated: number;
  outsideWindow: number;
  decidedToday: number;
  noRule: number;
  /** max_per_run'a takilanlar — kayit yazilmaz, sonraki tikte tekrar degerlendirilirler. */
  runCapped: number;
  decisions: EngineDecision[];
}

export { DECISION_WINDOW_MS };
/** Testler ve backoffice ayni kovayi buradan da gorebilsin (asil yeri throttle.ts). */
export { holdoutBucket };

function hasDecisionSince(ctx: EngineContext, userId: string, sinceMs: number): boolean {
  return (ctx.logByUser.get(userId) ?? []).some((e) => e.createdAt >= sinceMs);
}

function prefDisabled(user: EngineUser, category: RuleCategory): boolean {
  return (user.notification_preferences?.[category] ?? true) === false;
}

export function pickRule(
  user: EngineUser,
  ctx: EngineContext,
  config: EngineConfig,
  nowMs: number,
  rules: readonly LifecycleRule[] = LIFECYCLE_RULES,
): { rule: LifecycleRule; match: RuleMatch; step: number } | null {
  const entries = ctx.logByUser.get(user.id) ?? [];
  for (const rule of rules) {
    const ruleConfig = config.rules[rule.key];
    if (!ruleConfig.enabled) continue;
    const progress = sequenceProgress(user, entries, rule, ruleConfig.schedule_days, nowMs);
    if (progress.state !== 'ready') continue;
    const match = rule.evaluate(user, ctx);
    if (match) return { rule, match, step: progress.step + 1 };
  }
  return null;
}

// ── push_log yazimi ────────────────────────────────────────────────────────────

function logPayload(d: EngineDecision) {
  return {
    title: d.title,
    body: d.body,
    action_url: d.actionUrl,
    sequence_step: d.sequenceStep,
    ...(d.channel ? { channel: d.channel } : {}),
  };
}

/** Karari kaydeder; basarisizsa null (cagiran gonderimi iptal eder). created_at acikca kosum zamani. */
async function insertDecision(runId: string, mode: EffectiveMode, now: Date, d: EngineDecision): Promise<number | null> {
  const { data, error } = await supabase
    .from('push_log')
    .insert({
      run_id: runId,
      mode: mode === 'dry_run' ? 'dry_run' : 'live',
      user_id: d.userId,
      rule_key: d.ruleKey,
      decision: d.decision,
      reason: d.reason,
      locale: d.locale,
      payload: logPayload(d),
      notification_id: d.notificationId,
      created_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[NotificationEngine] push_log yazilamadi:', error?.message ?? 'no row');
    return null;
  }
  return (data as { id: number }).id;
}

async function finalizeDecision(logId: number, d: EngineDecision): Promise<void> {
  const { error } = await supabase
    .from('push_log')
    .update({ decision: d.decision, reason: d.reason, payload: logPayload(d), notification_id: d.notificationId })
    .eq('id', logId);
  if (error) console.error('[NotificationEngine] push_log guncellenemedi:', error.message);
}

// ── kosum ──────────────────────────────────────────────────────────────────────

export async function runEngine(mode: EngineMode = 'live', opts: { now?: Date } = {}): Promise<EngineRunResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const loaded = await loadEngineConfig();
  const { config } = loaded;
  const effective: EffectiveMode = mode === 'simulate' ? 'simulate' : config.dry_run ? 'dry_run' : 'live';

  const result: EngineRunResult = {
    runId: randomUUID(),
    mode: effective,
    enabled: config.enabled,
    tableMissing: loaded.tableMissing,
    evaluated: 0,
    outsideWindow: 0,
    decidedToday: 0,
    noRule: 0,
    runCapped: 0,
    decisions: [],
  };
  if (mode === 'live' && (!config.enabled || loaded.tableMissing)) return result;

  if (loaded.usedDefaults) console.warn('[NotificationEngine] DB config gecersiz — varsayilanlar (dry_run) kullaniliyor, backoffice\'ten kaydet');
  const ctx = await loadContext(now);
  const persist = mode === 'live';
  let sends = 0;

  /** Gonderimsiz karar: sonuca ekle, canli modda kaydet. */
  const record = async (d: EngineDecision): Promise<void> => {
    result.decisions.push(d);
    if (persist) await insertDecision(result.runId, effective, now, d);
  };

  for (const user of ctx.users) {
    result.evaluated++;
    if (mode === 'live') {
      if (localHour(now, utcOffsetHours(user)) !== config.send_hour_local) {
        result.outsideWindow++;
        continue;
      }
      if (hasDecisionSince(ctx, user.id, nowMs - DECISION_WINDOW_MS)) {
        result.decidedToday++;
        continue;
      }
    }

    const picked = pickRule(user, ctx, config, nowMs);
    if (!picked) {
      result.noRule++;
      continue;
    }
    const { rule, match, step } = picked;
    const locale = resolveLocale(user.locale);
    const base: EngineDecision = {
      userId: user.id,
      userName: user.name ?? '',
      ruleKey: rule.key,
      decision: 'suppressed',
      reason: null,
      locale,
      actionUrl: match.actionUrl,
      title: null,
      body: null,
      notificationId: null,
      sequenceStep: step,
    };

    // Tavan + holdout: throttle.ts (kampanya gondericisiyle ortak)
    const throttled = throttleReason(user.id, ctx.sendTimes, config, nowMs);
    if (throttled === 'holdout') { await record({ ...base, decision: 'holdout', reason: 'holdout' }); continue; }
    if (throttled) { await record({ ...base, reason: throttled }); continue; }
    if (prefDisabled(user, rule.category)) { await record({ ...base, reason: 'pref_off' }); continue; }

    // Her modda once sablon: susturulmus/eksik sablon canli modda da inbox'a "[type]" satiri yazdirmamali
    const rendered = await NotificationService.renderPush(match.templateKey ?? rule.key, locale, match.params);
    if (!rendered) { await record({ ...base, reason: 'template_muted' }); continue; }

    if (effective !== 'live') {
      await record({ ...base, decision: 'dry_run', title: rendered.title, body: rendered.body });
      continue;
    }

    // Tur limiti: karar yazilmaz (yazilsa "bugun karar verildi" sayilir ve ayni kullanicilar her gun ac kalir)
    if (sends >= config.max_per_run) { result.runCapped++; continue; }

    // Iki fazli kayit: once 'in_flight' (dayanikli "bugun karar verildi" isareti), sonra FCM, sonra guncelle
    const inFlight: EngineDecision = { ...base, decision: 'failed', reason: 'in_flight', title: rendered.title, body: rendered.body };
    const logId = await insertDecision(result.runId, effective, now, inFlight);
    if (logId === null) {
      result.decisions.push({ ...base, reason: 'log_write_failed' });
      continue;
    }
    sends++;
    const sent = await NotificationService.sendPushDetailed(user.id, rule.key, match.params, undefined, {
      actionUrl: match.actionUrl,
      templateKey: match.templateKey,
    });
    const final: EngineDecision = {
      ...base,
      decision: sent.sent ? 'sent' : 'failed',
      reason: sent.sent ? null : sent.reason ?? 'unknown',
      title: sent.title ?? rendered.title,
      body: sent.body ?? rendered.body,
      notificationId: sent.notificationId,
    };
    result.decisions.push(final);
    await finalizeDecision(logId, final);
  }

  // E-posta yedegi (2.0.18): push token'i olmayan hedef. Gercek kullaniciya e-posta gider — anahtar
  // `app_config.recall_email_enabled` VARSAYILAN KAPALI, okunamazsa da kapali (fail-closed).
  if (ctx.emailFallbackUsers.length > 0 && (await appConfigService.getRecallEmailEnabled())) {
    const emailRules = LIFECYCLE_RULES.filter((r) => EMAIL_FALLBACK_RULE_KEYS.has(r.key));
    for (const user of ctx.emailFallbackUsers) {
      result.evaluated++;
      if (mode === 'live') {
        if (localHour(now, utcOffsetHours(user)) !== config.send_hour_local) { result.outsideWindow++; continue; }
        if (hasDecisionSince(ctx, user.id, nowMs - DECISION_WINDOW_MS)) { result.decidedToday++; continue; }
      }
      const picked = pickRule(user, ctx, config, nowMs, emailRules);
      if (!picked) { result.noRule++; continue; }
      const { rule, match, step } = picked;
      const locale = resolveLocale(user.locale);
      const base: EngineDecision = {
        userId: user.id,
        userName: user.name ?? '',
        ruleKey: rule.key,
        decision: 'suppressed',
        reason: null,
        locale,
        actionUrl: match.actionUrl,
        title: null,
        body: null,
        notificationId: null,
        sequenceStep: step,
        channel: 'email',
      };
      // Ayni "bogmama" politikasi: tavan + holdout (olcum push'la ayni kovada kalsin) + kategori tercihi.
      const throttled = throttleReason(user.id, ctx.sendTimes, config, nowMs);
      if (throttled === 'holdout') { await record({ ...base, decision: 'holdout', reason: 'holdout' }); continue; }
      if (throttled) { await record({ ...base, reason: throttled }); continue; }
      if (prefDisabled(user, rule.category)) { await record({ ...base, reason: 'pref_off' }); continue; }

      const rendered = await NotificationService.renderPush(match.templateKey ?? rule.key, locale, match.params);
      if (!rendered) { await record({ ...base, reason: 'template_muted' }); continue; }
      const withText = { ...base, title: rendered.title, body: rendered.body };
      if (effective !== 'live') { await record({ ...withText, decision: 'dry_run' }); continue; }

      // Gonderilmeyecek hedef (tercih/adres/dogrulama/son 20 sa e-posta) tur butcesini harcamadan elenir.
      const prepared = await matchRecallEmailService.prepare(user.id, now);
      if (!prepared.ok) {
        if (prepared.reason === 'lookup_failed') { result.decisions.push({ ...withText, decision: 'failed', reason: prepared.reason }); continue; }
        await record({ ...withText, reason: prepared.reason });
        continue;
      }
      if (sends >= config.max_per_run) { result.runCapped++; continue; }

      const logId = await insertDecision(result.runId, effective, now, { ...withText, decision: 'failed', reason: 'in_flight' });
      if (logId === null) { result.decisions.push({ ...withText, reason: 'log_write_failed' }); continue; }
      sends++;
      const delivered = await matchRecallEmailService.deliver(prepared.target, rendered);
      const final: EngineDecision = delivered
        ? { ...withText, decision: 'sent', reason: null }
        : { ...withText, decision: 'failed', reason: 'send_failed' };
      result.decisions.push(final);
      await finalizeDecision(logId, final);
    }
  }

  return result;
}

export function summarizeDecisions(decisions: EngineDecision[]): Record<DecisionKind, number> {
  const counts: Record<DecisionKind, number> = { sent: 0, dry_run: 0, suppressed: 0, holdout: 0, failed: 0 };
  for (const d of decisions) counts[d.decision]++;
  return counts;
}
