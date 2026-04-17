import { supabase } from "../config/supabase.js";

interface FlowFunnelStep {
  step: string;
  label: string;
  count: number;
  percentage: number;
}

interface FlowCombination {
  sequence_key: string;
  steps: string[];
  total_occurrences: number;
  unique_users: number;
  last_seen_at: string;
}

interface FeatureUsage {
  event_name: string;
  category: string;
  total_count: number;
  unique_users: number;
}

interface HourlyActivity {
  hour: number;
  count: number;
}

interface DailyTrend {
  date: string;
  count: number;
  unique_users: number;
}

interface AnalyticsOverview {
  totalEvents: number;
  totalUniqueUsers: number;
  todayEvents: number;
  avgResponseTime: number;
  topEndpoints: Array<{ endpoint: string; count: number }>;
  errorRate: number;
}

class AnalyticsService {

  /** Overview stats for the analytics dashboard */
  async getOverview(days: number = 7): Promise<AnalyticsOverview> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

    const [
      { count: totalEvents },
      { count: todayEvents },
    ] = await Promise.all([
      supabase.from("flow_events").select("*", { count: "exact", head: true }).gte("created_at", since),
      supabase.from("flow_events").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
    ]);

    // Unique users in period
    const { data: uniqueData } = await supabase.rpc("count_unique_flow_users", { since_date: since }).single() as { data: any };

    // Average response time
    const { data: avgData } = await supabase.rpc("avg_flow_response_time", { since_date: since }).single() as { data: any };

    // Top endpoints
    const { data: topEndpoints } = await supabase.rpc("top_flow_endpoints", { since_date: since, limit_count: 10 });

    // Error rate (4xx + 5xx)
    const { count: errorCount } = await supabase
      .from("flow_events")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since)
      .gte("status_code", 400);

    return {
      totalEvents: totalEvents ?? 0,
      totalUniqueUsers: uniqueData?.count ?? 0,
      todayEvents: todayEvents ?? 0,
      avgResponseTime: Math.round(avgData?.avg ?? 0),
      topEndpoints: (topEndpoints ?? []).map((e: any) => ({ endpoint: e.event_name, count: Number(e.cnt) })),
      errorRate: totalEvents ? Math.round(((errorCount ?? 0) / (totalEvents ?? 1)) * 100) : 0,
    };
  }

  /** Main conversion funnel: register → onboard → discover → quiz → match → chat */
  async getConversionFunnel(days: number = 30): Promise<FlowFunnelStep[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const funnelSteps = [
      { step: "register", label: "Register / Login" },
      { step: "complete_profile", label: "Profile Completed" },
      { step: "discover_load", label: "Discover Loaded" },
      { step: "swipe", label: "Swipe" },
      { step: "quiz_start", label: "Quiz Started" },
      { step: "quiz_answer", label: "Quiz Answered" },
      { step: "get_matches_list", label: "Matches Viewed" },
      { step: "send_message", label: "Message Sent" },
    ];

    const counts = await Promise.all(
      funnelSteps.map(async ({ step }) => {
        // Count unique users who performed this action
        const { data } = await supabase.rpc("count_unique_flow_users_by_event", {
          event: step,
          since_date: since,
        });
        return data?.[0]?.count ?? 0;
      })
    );

    // Also count login + register + social_login together for first step
    const { data: authData } = await supabase.rpc("count_unique_auth_users", { since_date: since });
    const authCount = authData?.[0]?.count ?? counts[0];

    const maxCount = Math.max(authCount, 1);

    return funnelSteps.map((step, i) => ({
      step: step.step,
      label: step.label,
      count: i === 0 ? authCount : counts[i],
      percentage: Math.round(((i === 0 ? authCount : counts[i]) / maxCount) * 100),
    }));
  }

  /** Feature usage breakdown by category */
  async getFeatureUsage(days: number = 7): Promise<FeatureUsage[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_feature_usage", { since_date: since });

    return (data ?? []).map((r: any) => ({
      event_name: r.event_name,
      category: r.event_category,
      total_count: Number(r.total_count),
      unique_users: Number(r.unique_users),
    }));
  }

  /** Hourly activity distribution */
  async getHourlyActivity(days: number = 7): Promise<HourlyActivity[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_hourly_activity", { since_date: since });

    // Fill in missing hours with 0
    const hourMap = new Map<number, number>();
    for (let h = 0; h < 24; h++) hourMap.set(h, 0);
    (data ?? []).forEach((r: any) => hourMap.set(Number(r.hour), Number(r.cnt)));

    return Array.from(hourMap.entries()).map(([hour, count]) => ({ hour, count }));
  }

  /** Daily trend for the last N days */
  async getDailyTrend(days: number = 30): Promise<DailyTrend[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_daily_trend", { since_date: since });

    return (data ?? []).map((r: any) => ({
      date: r.day,
      count: Number(r.cnt),
      unique_users: Number(r.unique_users),
    }));
  }

  /** Flow combinations - detected user journey patterns */
  async getFlowCombinations(days: number = 7, limit: number = 20): Promise<FlowCombination[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_user_sequences", {
      since_date: since,
      seq_limit: limit,
    });

    return (data ?? []).map((r: any) => ({
      sequence_key: r.sequence_key,
      steps: r.steps,
      total_occurrences: Number(r.total_occurrences),
      unique_users: Number(r.unique_users),
      last_seen_at: r.last_seen_at,
    }));
  }

  /** Category breakdown - pie chart data */
  async getCategoryBreakdown(days: number = 7): Promise<Array<{ category: string; count: number; percentage: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_category_breakdown", { since_date: since });

    const total = (data ?? []).reduce((sum: number, r: any) => sum + Number(r.cnt), 0) || 1;

    return (data ?? []).map((r: any) => ({
      category: r.event_category,
      count: Number(r.cnt),
      percentage: Math.round((Number(r.cnt) / total) * 100),
    }));
  }

  /** Response time by endpoint - performance insights */
  async getResponseTimeStats(days: number = 7): Promise<Array<{ endpoint: string; avg_ms: number; p95_ms: number; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_response_time_stats", { since_date: since });

    return (data ?? []).map((r: any) => ({
      endpoint: r.event_name,
      avg_ms: Math.round(Number(r.avg_ms)),
      p95_ms: Math.round(Number(r.p95_ms)),
      count: Number(r.cnt),
    }));
  }
  /** Recent events feed - last N events for real-time monitoring */
  async getRecentEvents(limit: number = 30): Promise<Array<{
    event_name: string;
    category: string;
    user_id: string | null;
    status_code: number;
    response_time_ms: number;
    created_at: string;
  }>> {
    const { data } = await supabase
      .from("flow_events")
      .select("event_name, event_category, user_id, status_code, response_time_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data ?? []).map((r: any) => ({
      event_name: r.event_name,
      category: r.event_category,
      user_id: r.user_id,
      status_code: r.status_code,
      response_time_ms: r.response_time_ms,
      created_at: r.created_at,
    }));
  }

  /** User journey for a specific user - their last N events */
  async getUserJourney(userId: string, limit: number = 50): Promise<Array<{
    event_name: string;
    category: string;
    status_code: number;
    response_time_ms: number;
    created_at: string;
  }>> {
    const { data } = await supabase
      .from("flow_events")
      .select("event_name, event_category, status_code, response_time_ms, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data ?? []).map((r: any) => ({
      event_name: r.event_name,
      category: r.event_category,
      status_code: r.status_code,
      response_time_ms: r.response_time_ms,
      created_at: r.created_at,
    }));
  }

  /** Active users right now (last 5 minutes) */
  async getActiveUsersNow(): Promise<{ count: number; users: Array<{ user_id: string; last_event: string; event_count: number }> }> {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_active_users_now", { since_ts: fiveMinAgo });

    return {
      count: data?.length ?? 0,
      users: (data ?? []).map((r: any) => ({
        user_id: r.user_id,
        last_event: r.last_event,
        event_count: Number(r.event_count),
      })),
    };
  }

  /** Error breakdown - which endpoints fail the most */
  async getErrorBreakdown(days: number = 7): Promise<Array<{ endpoint: string; error_count: number; total_count: number; error_rate: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase.rpc("flow_error_breakdown", { since_date: since });

    return (data ?? []).map((r: any) => ({
      endpoint: r.event_name,
      error_count: Number(r.error_count),
      total_count: Number(r.total_count),
      error_rate: Math.round(Number(r.error_rate)),
    }));
  }
  /** Retention cohort analysis - weekly retention rates */
  async getRetentionCohort(weeksBack: number = 8): Promise<{
    cohorts: Array<{ week: string; size: number }>;
    matrix: Array<Array<number | null>>; // retention_rate per cohort per week
  }> {
    const { data } = await supabase.rpc("flow_retention_cohort", { weeks_back: weeksBack });

    if (!data || data.length === 0) {
      return { cohorts: [], matrix: [] };
    }

    // Group by cohort week
    const cohortMap = new Map<string, { size: number; weeks: Map<number, number> }>();

    (data as any[]).forEach((r) => {
      const week = r.cohort_week;
      if (!cohortMap.has(week)) {
        cohortMap.set(week, { size: Number(r.cohort_size), weeks: new Map() });
      }
      cohortMap.get(week)!.weeks.set(Number(r.week_number), Number(r.retention_rate));
    });

    const cohorts: Array<{ week: string; size: number }> = [];
    const matrix: Array<Array<number | null>> = [];

    const maxWeek = 8;
    for (const [week, info] of cohortMap) {
      cohorts.push({ week, size: info.size });
      const row: Array<number | null> = [];
      for (let w = 0; w <= maxWeek; w++) {
        row.push(info.weeks.get(w) ?? null);
      }
      matrix.push(row);
    }

    return { cohorts, matrix };
  }

  /** Table size stats for monitoring */
  async getTableStats(): Promise<Array<{ table_name: string; row_count: number; size_pretty: string }>> {
    const { data } = await supabase.rpc("flow_table_stats");

    return (data ?? []).map((r: any) => ({
      table_name: r.table_name,
      row_count: Number(r.row_count),
      size_pretty: r.size_pretty,
    }));
  }
  /** Peak hours heatmap: 7 days x 24 hours matrix */
  async getPeakHoursHeatmap(days: number = 7): Promise<number[][]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_peak_hours_heatmap", { since_date: since });

    // Initialize 7x24 matrix (Mon-Sun x 0-23h)
    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

    (data ?? []).forEach((r: any) => {
      const dow = Number(r.day_of_week) - 1; // 0=Mon, 6=Sun
      const hour = Number(r.hour);
      if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
        matrix[dow][hour] = Number(r.cnt);
      }
    });

    return matrix;
  }

  /** Conversion comparison: current period vs previous period */
  async getConversionComparison(days: number = 7): Promise<Array<{
    event_name: string;
    current_count: number;
    previous_count: number;
    current_users: number;
    previous_users: number;
    change_pct: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_conversion_comparison", {
      since_date: since,
      period_days: days,
    });

    return (data ?? []).map((r: any) => {
      const current = Number(r.current_count);
      const previous = Number(r.previous_count);
      const changePct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : current > 0 ? 100 : 0;
      return {
        event_name: r.event_name,
        current_count: current,
        previous_count: previous,
        current_users: Number(r.current_users),
        previous_users: Number(r.previous_users),
        change_pct: changePct,
      };
    });
  }

  /** User session timeline - grouped by 30min gaps */
  async getUserSessions(userId: string, maxSessions: number = 5): Promise<Array<{
    session_num: number;
    session_start: string;
    session_end: string;
    duration_seconds: number;
    event_count: number;
    events: Array<{ name: string; category: string; status: number; ms: number; at: string }>;
  }>> {
    const { data } = await supabase.rpc("flow_user_sessions", {
      target_user_id: userId,
      max_sessions: maxSessions,
    });

    return (data ?? []).map((r: any) => ({
      session_num: r.session_num,
      session_start: r.session_start,
      session_end: r.session_end,
      duration_seconds: r.duration_seconds,
      event_count: r.event_count,
      events: r.events ?? [],
    }));
  }
  /** Flow transition matrix - from_event → to_event counts */
  async getTransitionMatrix(days: number = 7): Promise<Array<{
    from_event: string;
    to_event: string;
    count: number;
    unique_users: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_transition_matrix", { since_date: since, min_count: 2 });

    return (data ?? []).map((r: any) => ({
      from_event: r.from_event,
      to_event: r.to_event,
      count: Number(r.transition_count),
      unique_users: Number(r.unique_users),
    }));
  }
  /** Power users - most active users */
  async getPowerUsers(days: number = 7): Promise<Array<{
    user_id: string;
    event_count: number;
    distinct_events: number;
    first_seen: string;
    last_seen: string;
    session_count: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_power_users", { since_date: since, top_n: 10 });

    return (data ?? []).map((r: any) => ({
      user_id: r.user_id,
      event_count: Number(r.event_count),
      distinct_events: Number(r.distinct_events),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      session_count: Number(r.session_count),
    }));
  }

  /** Drop-off analysis for funnel steps */
  async getDropOffAnalysis(days: number = 7): Promise<Array<{
    step_name: string;
    step_order: number;
    unique_users: number;
    drop_off_pct: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_drop_off_analysis", { since_date: since });

    const rows = (data ?? []).map((r: any) => ({
      step_name: r.step_name,
      step_order: Number(r.step_order),
      unique_users: Number(r.unique_users),
      drop_off_pct: 0,
    }));

    // Calculate drop-off percentages
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].unique_users;
      const curr = rows[i].unique_users;
      rows[i].drop_off_pct = prev > 0 ? Math.round(((prev - curr) / prev) * 100) : 0;
    }

    return rows;
  }
  /** Bounce rate - single-event session percentage */
  async getBounceRate(days: number = 7): Promise<{ total: number; bounced: number; rate: number }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_bounce_rate", { since_date: since }) as { data: any };

    const row = Array.isArray(data) ? data[0] : data;
    return {
      total: Number(row?.total_sessions ?? 0),
      bounced: Number(row?.bounce_sessions ?? 0),
      rate: Number(row?.bounce_rate ?? 0),
    };
  }

  /** Average session duration */
  async getSessionDuration(days: number = 7): Promise<{ avg_seconds: number; median_seconds: number; total_sessions: number }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_avg_session_duration", { since_date: since }) as { data: any };

    const row = Array.isArray(data) ? data[0] : data;
    return {
      avg_seconds: Number(row?.avg_duration_seconds ?? 0),
      median_seconds: Number(row?.median_duration_seconds ?? 0),
      total_sessions: Number(row?.total_sessions ?? 0),
    };
  }

  /** Platform breakdown (iOS vs Android) */
  async getPlatformBreakdown(days: number = 7): Promise<Array<{ platform: string; user_count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_platform_breakdown", { since_date: since });

    return (data ?? []).map((r: any) => ({
      platform: r.platform,
      user_count: Number(r.user_count),
    }));
  }
  /** DAU/WAU/MAU + stickiness ratio */
  async getActiveUserMetrics(): Promise<{ dau: number; wau: number; mau: number; stickiness: number }> {
    const { data } = await supabase.rpc("flow_active_users_metrics") as { data: any };
    const row = Array.isArray(data) ? data[0] : data;
    return {
      dau: Number(row?.dau ?? 0),
      wau: Number(row?.wau ?? 0),
      mau: Number(row?.mau ?? 0),
      stickiness: Number(row?.stickiness ?? 0),
    };
  }

  /** DAU time series for trend chart */
  async getDauTimeseries(daysBack: number = 30): Promise<Array<{ day: string; dau: number }>> {
    const { data } = await supabase.rpc("flow_dau_timeseries", { days_back: daysBack });
    return (data ?? []).map((r: any) => ({
      day: r.day,
      dau: Number(r.dau),
    }));
  }

  /** Time-to-first-action distribution */
  async getTimeToFirstAction(daysBack: number = 30): Promise<Array<{ bucket: string; bucket_order: number; user_count: number }>> {
    const { data } = await supabase.rpc("flow_time_to_first_action", { days_back: daysBack });
    return (data ?? []).map((r: any) => ({
      bucket: r.bucket,
      bucket_order: Number(r.bucket_order),
      user_count: Number(r.user_count),
    }));
  }

  /** Custom funnel: conversion between two events */
  async getCustomFunnel(
    fromEvent: string,
    toEvent: string,
    days: number = 7,
    windowHours: number = 24,
  ): Promise<{
    from_users: number;
    to_users: number;
    conversion_rate: number;
    avg_time_seconds: number;
    median_time_seconds: number;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_custom_funnel", {
      from_event: fromEvent,
      to_event: toEvent,
      since_date: since,
      window_hours: windowHours,
    }) as { data: any };

    const row = Array.isArray(data) ? data[0] : data;
    return {
      from_users: Number(row?.from_users ?? 0),
      to_users: Number(row?.to_users ?? 0),
      conversion_rate: Number(row?.conversion_rate ?? 0),
      avg_time_seconds: Number(row?.avg_time_seconds ?? 0),
      median_time_seconds: Number(row?.median_time_seconds ?? 0),
    };
  }

  /** Distinct event names with counts (for funnel builder dropdowns) */
  async getDistinctEvents(days: number = 30): Promise<Array<{ event_name: string; event_count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_distinct_events", { since_date: since });
    return (data ?? []).map((r: any) => ({
      event_name: r.event_name,
      event_count: Number(r.event_count),
    }));
  }

  /** Segment comparison: Premium vs Plus vs Free behavior */
  async getSegmentComparison(days: number = 7): Promise<Array<{
    segment: string;
    user_count: number;
    event_count: number;
    avg_events_per_user: number;
    distinct_actions: number;
    avg_session_minutes: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_segment_comparison", { since_date: since });
    return (data ?? []).map((r: any) => ({
      segment: r.segment,
      user_count: Number(r.user_count),
      event_count: Number(r.event_count),
      avg_events_per_user: Number(r.avg_events_per_user),
      distinct_actions: Number(r.distinct_actions),
      avg_session_minutes: Number(r.avg_session_minutes),
    }));
  }

  /** Top features per subscription segment */
  async getSegmentTopFeatures(days: number = 7): Promise<Array<{
    segment: string;
    event_name: string;
    event_count: number;
    unique_users: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_segment_top_features", { since_date: since, top_n: 5 });
    return (data ?? []).map((r: any) => ({
      segment: r.segment,
      event_name: r.event_name,
      event_count: Number(r.event_count),
      unique_users: Number(r.unique_users),
    }));
  }

  /** Gender breakdown */
  async getGenderBreakdown(days: number = 7): Promise<Array<{
    gender: string;
    user_count: number;
    event_count: number;
    avg_events_per_user: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_gender_breakdown", { since_date: since });
    return (data ?? []).map((r: any) => ({
      gender: r.gender,
      user_count: Number(r.user_count),
      event_count: Number(r.event_count),
      avg_events_per_user: Number(r.avg_events_per_user),
    }));
  }

  /** Age group breakdown */
  async getAgeGroupBreakdown(days: number = 7): Promise<Array<{
    age_group: string;
    group_order: number;
    user_count: number;
    event_count: number;
    avg_events_per_user: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_age_group_breakdown", { since_date: since });
    return (data ?? []).map((r: any) => ({
      age_group: r.age_group,
      group_order: Number(r.group_order),
      user_count: Number(r.user_count),
      event_count: Number(r.event_count),
      avg_events_per_user: Number(r.avg_events_per_user),
    }));
  }

  /** Top features per gender */
  async getGenderTopFeatures(days: number = 7): Promise<Array<{
    gender: string;
    event_name: string;
    event_count: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_gender_top_features", { since_date: since, top_n: 5 });
    return (data ?? []).map((r: any) => ({
      gender: r.gender,
      event_name: r.event_name,
      event_count: Number(r.event_count),
    }));
  }

  /** Top cities by user activity */
  async getCityBreakdown(days: number = 7): Promise<Array<{
    city: string;
    user_count: number;
    event_count: number;
    avg_events_per_user: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.rpc("flow_city_breakdown", { since_date: since, top_n: 15 });
    return (data ?? []).map((r: any) => ({
      city: r.city,
      user_count: Number(r.user_count),
      event_count: Number(r.event_count),
      avg_events_per_user: Number(r.avg_events_per_user),
    }));
  }

  /** Generate auto-insights from analytics data */
  generateInsights(data: {
    overview: { totalEvents: number; errorRate: number; avgResponseTime: number };
    bounceRate: { rate: number };
    sessionDuration: { avg_seconds: number };
    dropOff: Array<{ step_name: string; drop_off_pct: number }>;
    comparison: Array<{ event_name: string; change_pct: number; current_count: number }>;
    transitions: Array<{ from_event: string; to_event: string; count: number }>;
    flowCombinations: Array<{ sequence_key: string; total_occurrences: number }>;
  }): { alerts: Array<{ level: string; message: string }>; insights: string[] } {
    const alerts: Array<{ level: string; message: string }> = [];
    const insights: string[] = [];

    // Alerts
    if (data.overview.errorRate > 10) {
      alerts.push({ level: "critical", message: `Error rate critically high: ${data.overview.errorRate}%` });
    } else if (data.overview.errorRate > 5) {
      alerts.push({ level: "warning", message: `Error rate above threshold: ${data.overview.errorRate}%` });
    }

    if (data.bounceRate.rate > 50) {
      alerts.push({ level: "critical", message: `Bounce rate very high: ${data.bounceRate.rate}% of sessions have only 1 action` });
    } else if (data.bounceRate.rate > 30) {
      alerts.push({ level: "warning", message: `Bounce rate elevated: ${data.bounceRate.rate}%` });
    }

    if (data.overview.avgResponseTime > 500) {
      alerts.push({ level: "warning", message: `Average response time slow: ${data.overview.avgResponseTime}ms` });
    }

    // Insights: biggest drop-off
    const worstDrop = data.dropOff
      .filter(d => d.drop_off_pct > 0)
      .sort((a, b) => b.drop_off_pct - a.drop_off_pct)[0];
    if (worstDrop) {
      insights.push(`Biggest funnel drop: ${worstDrop.drop_off_pct}% users lost at "${worstDrop.step_name}" step`);
    }

    // Insights: top growing event
    const growing = data.comparison
      .filter(c => c.change_pct > 0 && c.current_count > 5)
      .sort((a, b) => b.change_pct - a.change_pct)[0];
    if (growing) {
      insights.push(`Fastest growing: "${growing.event_name}" up ${growing.change_pct}% vs previous period`);
    }

    // Insights: top declining event
    const declining = data.comparison
      .filter(c => c.change_pct < -10 && c.current_count > 0)
      .sort((a, b) => a.change_pct - b.change_pct)[0];
    if (declining) {
      insights.push(`Notable decline: "${declining.event_name}" down ${Math.abs(declining.change_pct)}%`);
    }

    // Insights: most common flow
    if (data.flowCombinations.length > 0) {
      const top = data.flowCombinations[0];
      insights.push(`Most common flow: "${top.sequence_key}" (${top.total_occurrences} sessions)`);
    }

    // Insights: hottest transition
    if (data.transitions.length > 0) {
      const t = data.transitions[0];
      insights.push(`Most frequent transition: ${t.from_event} → ${t.to_event} (${t.count} times)`);
    }

    // Insights: session duration
    if (data.sessionDuration.avg_seconds > 0) {
      const mins = Math.floor(data.sessionDuration.avg_seconds / 60);
      if (mins < 1) {
        insights.push("Average session under 1 minute — users may not be finding value quickly");
      } else if (mins > 15) {
        insights.push(`Strong engagement: average session ${mins} minutes`);
      }
    }

    // Insights: total activity
    if (data.overview.totalEvents === 0) {
      insights.push("No events recorded yet. Analytics will populate as users interact with the API.");
    }

    return { alerts, insights };
  }
}

export const analyticsService = new AnalyticsService();
