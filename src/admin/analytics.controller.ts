import type { Request, Response } from "express";
import { analyticsService } from "./analytics.service.js";
import { analyticsCache } from "./analytics.cache.js";

function parseDays(raw: unknown): number {
  const n = parseInt(raw as string) || 7;
  return Math.max(1, Math.min(n, 365));
}

/** Shortcut to memoize a service call with a key built from the section + days. */
function cached<T>(key: string, factory: () => Promise<T>, bypass: boolean): Promise<T> {
  return analyticsCache.memoize(key, factory, 5 * 60 * 1000, bypass);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class AnalyticsController {
  async page(req: Request, res: Response) {
    const days = parseDays(req.query.days);
    const bypass = req.query.nocache === "1";

    try {
      // Live data (short TTL or no cache) — real-time widgets
      // Cached data (5min TTL) — expensive aggregate queries
      const [overview, funnel, featureUsage, hourly, daily, flowCombinations, categoryBreakdown, responseTime, recentEvents, activeNow, errors, retention, tableStats, peakHours, comparison, transitions, powerUsers, dropOff, bounceRate, sessionDuration, platforms, activeUsersMetrics, dauTimeseries, timeToFirstAction, distinctEvents, segmentComparison, segmentTopFeatures, genderBreakdown, ageGroups, genderTopFeatures, cityBreakdown] =
        await Promise.all([
          cached(`overview:${days}`, () => analyticsService.getOverview(days), bypass),
          cached(`funnel:${days}`, () => analyticsService.getConversionFunnel(days), bypass),
          cached(`featureUsage:${days}`, () => analyticsService.getFeatureUsage(days), bypass),
          cached(`hourly:${days}`, () => analyticsService.getHourlyActivity(days), bypass),
          cached(`daily:${days}`, () => analyticsService.getDailyTrend(days), bypass),
          cached(`flowCombinations:${days}`, () => analyticsService.getFlowCombinations(days), bypass),
          cached(`categoryBreakdown:${days}`, () => analyticsService.getCategoryBreakdown(days), bypass),
          cached(`responseTime:${days}`, () => analyticsService.getResponseTimeStats(days), bypass),
          // Always fresh — real-time widgets
          analyticsService.getRecentEvents(30),
          analyticsService.getActiveUsersNow(),
          cached(`errors:${days}`, () => analyticsService.getErrorBreakdown(days), bypass),
          cached(`retention`, () => analyticsService.getRetentionCohort(8), bypass),
          cached(`tableStats`, () => analyticsService.getTableStats(), bypass),
          cached(`peakHours:${days}`, () => analyticsService.getPeakHoursHeatmap(days), bypass),
          cached(`comparison:${days}`, () => analyticsService.getConversionComparison(days), bypass),
          cached(`transitions:${days}`, () => analyticsService.getTransitionMatrix(days), bypass),
          cached(`powerUsers:${days}`, () => analyticsService.getPowerUsers(days), bypass),
          cached(`dropOff:${days}`, () => analyticsService.getDropOffAnalysis(days), bypass),
          cached(`bounceRate:${days}`, () => analyticsService.getBounceRate(days), bypass),
          cached(`sessionDuration:${days}`, () => analyticsService.getSessionDuration(days), bypass),
          cached(`platforms:${days}`, () => analyticsService.getPlatformBreakdown(days), bypass),
          cached(`activeUsersMetrics`, () => analyticsService.getActiveUserMetrics(), bypass),
          cached(`dauTimeseries`, () => analyticsService.getDauTimeseries(30), bypass),
          cached(`timeToFirstAction`, () => analyticsService.getTimeToFirstAction(30), bypass),
          cached(`distinctEvents`, () => analyticsService.getDistinctEvents(30), bypass),
          cached(`segmentComparison:${days}`, () => analyticsService.getSegmentComparison(days), bypass),
          cached(`segmentTopFeatures:${days}`, () => analyticsService.getSegmentTopFeatures(days), bypass),
          cached(`genderBreakdown:${days}`, () => analyticsService.getGenderBreakdown(days), bypass),
          cached(`ageGroups:${days}`, () => analyticsService.getAgeGroupBreakdown(days), bypass),
          cached(`genderTopFeatures:${days}`, () => analyticsService.getGenderTopFeatures(days), bypass),
          cached(`cityBreakdown:${days}`, () => analyticsService.getCityBreakdown(days), bypass),
        ]);

      res.render("analytics", {
        session: req.session,
        currentPath: "/admin/analytics",
        days,
        overview,
        funnel,
        featureUsage,
        hourly,
        daily,
        flowCombinations,
        categoryBreakdown,
        responseTime,
        recentEvents,
        activeNow,
        errors,
        retention,
        tableStats,
        peakHours,
        comparison,
        transitions,
        powerUsers,
        dropOff,
        bounceRate,
        sessionDuration,
        platforms,
        activeUsersMetrics,
        dauTimeseries,
        timeToFirstAction,
        distinctEvents,
        segmentComparison,
        segmentTopFeatures,
        genderBreakdown,
        ageGroups,
        genderTopFeatures,
        cityBreakdown,
        insights: analyticsService.generateInsights({
          overview, bounceRate, sessionDuration, dropOff, comparison, transitions, flowCombinations,
        }),
      });
    } catch (err) {
      console.error("[analytics] Page error:", (err as Error).message);
      res.render("analytics", {
        session: req.session,
        currentPath: "/admin/analytics",
        days,
        overview: { totalEvents: 0, totalUniqueUsers: 0, todayEvents: 0, avgResponseTime: 0, topEndpoints: [], errorRate: 0 },
        funnel: [],
        featureUsage: [],
        hourly: [],
        daily: [],
        flowCombinations: [],
        categoryBreakdown: [],
        responseTime: [],
        recentEvents: [],
        activeNow: { count: 0, users: [] },
        errors: [],
        retention: { cohorts: [], matrix: [] },
        tableStats: [],
        peakHours: Array.from({ length: 7 }, () => Array(24).fill(0)),
        comparison: [],
        transitions: [],
        powerUsers: [],
        dropOff: [],
        bounceRate: { total: 0, bounced: 0, rate: 0 },
        sessionDuration: { avg_seconds: 0, median_seconds: 0, total_sessions: 0 },
        platforms: [],
        activeUsersMetrics: { dau: 0, wau: 0, mau: 0, stickiness: 0 },
        dauTimeseries: [],
        timeToFirstAction: [],
        distinctEvents: [],
        segmentComparison: [],
        segmentTopFeatures: [],
        genderBreakdown: [],
        ageGroups: [],
        genderTopFeatures: [],
        cityBreakdown: [],
        insights: { alerts: [], insights: [] },
      });
    }
  }

  /** JSON API for AJAX updates */
  async apiData(req: Request, res: Response) {
    const days = parseDays(req.query.days);
    const section = req.query.section as string;

    try {
      let data: any;

      switch (section) {
        case "overview":
          data = await analyticsService.getOverview(days);
          break;
        case "funnel":
          data = await analyticsService.getConversionFunnel(days);
          break;
        case "feature-usage":
          data = await analyticsService.getFeatureUsage(days);
          break;
        case "hourly":
          data = await analyticsService.getHourlyActivity(days);
          break;
        case "daily":
          data = await analyticsService.getDailyTrend(days);
          break;
        case "flow-combinations":
          data = await analyticsService.getFlowCombinations(days);
          break;
        case "category":
          data = await analyticsService.getCategoryBreakdown(days);
          break;
        case "response-time":
          data = await analyticsService.getResponseTimeStats(days);
          break;
        case "recent-events":
          data = await analyticsService.getRecentEvents(30);
          break;
        case "active-now":
          data = await analyticsService.getActiveUsersNow();
          break;
        case "errors":
          data = await analyticsService.getErrorBreakdown(days);
          break;
        case "retention":
          data = await analyticsService.getRetentionCohort(8);
          break;
        case "table-stats":
          data = await analyticsService.getTableStats();
          break;
        case "peak-hours":
          data = await analyticsService.getPeakHoursHeatmap(days);
          break;
        case "comparison":
          data = await analyticsService.getConversionComparison(days);
          break;
        case "transitions":
          data = await analyticsService.getTransitionMatrix(days);
          break;
        case "custom-funnel": {
          const fromEvent = req.query.from as string;
          const toEvent = req.query.to as string;
          const windowHours = parseInt(req.query.window as string) || 24;
          // Tighter regex — no colons/spaces, only alphanumeric + underscore + hyphen + dot + slash (URL path style)
          const EVENT_RE = /^[a-zA-Z0-9_./ -]{1,100}$/;
          if (!fromEvent || !toEvent || !EVENT_RE.test(fromEvent) || !EVENT_RE.test(toEvent)) {
            res.json({ ok: false, error: "Valid from/to event names required" });
            return;
          }
          if (fromEvent === toEvent) {
            res.json({ ok: false, error: "From and to events must differ" });
            return;
          }
          if (windowHours < 1 || windowHours > 720) {
            res.json({ ok: false, error: "Window must be 1-720 hours" });
            return;
          }
          // Whitelist: only allow events that actually exist in the data (last 90 days)
          const validEvents = await analyticsService.getDistinctEvents(90);
          const validNames = new Set(validEvents.map((e) => e.event_name));
          if (!validNames.has(fromEvent) || !validNames.has(toEvent)) {
            res.json({ ok: false, error: "Unknown event name" });
            return;
          }
          data = await analyticsService.getCustomFunnel(fromEvent, toEvent, days, windowHours);
          break;
        }
        case "user-sessions": {
          const uid = req.query.userId as string;
          if (!uid || !UUID_RE.test(uid)) { res.json({ ok: false, error: "Valid userId required" }); return; }
          data = await analyticsService.getUserSessions(uid);
          break;
        }
        case "user-journey": {
          const userId = req.query.userId as string;
          if (!userId || !UUID_RE.test(userId)) {
            res.json({ ok: false, error: "Valid userId required" });
            return;
          }
          data = await analyticsService.getUserJourney(userId);
          break;
        }
        default:
          data = {};
      }

      res.json({ ok: true, data });
    } catch (err) {
      console.error("[analytics] API error:", (err as Error).message);
      res.status(500).json({ ok: false, error: "Internal error" });
    }
  }
  /** CSV export for feature usage and transitions */
  async exportCsv(req: Request, res: Response) {
    const days = parseDays(req.query.days);
    const type = req.query.type as string;

    // Whitelist export types
    const VALID_TYPES = ["feature-usage", "transitions", "flow-combinations"] as const;
    if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
      res.status(400).json({ error: "Invalid type. Use: feature-usage, transitions, flow-combinations" });
      return;
    }

    // CSV cell escape: wrap in quotes if contains comma/quote/newline/tab, prevent formula injection
    const escapeCsv = (val: unknown): string => {
      let s = String(val ?? "");
      // Prevent CSV formula injection (Excel/Sheets auto-executes =, +, -, @, \t)
      if (/^[=+\-@\t]/.test(s)) {
        s = "'" + s;
      }
      // Strip potentially malicious bidi/control chars (U+202E right-to-left override etc.)
      s = s.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
      if (/[",\n\r\t]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    try {
      let csv = "";
      let filename = "";

      if (type === "feature-usage") {
        const data = await analyticsService.getFeatureUsage(days);
        csv = "event_name,category,total_count,unique_users\n";
        data.forEach((r) => {
          csv += `${escapeCsv(r.event_name)},${escapeCsv(r.category)},${r.total_count},${r.unique_users}\n`;
        });
        filename = `feature-usage-${days}d.csv`;
      } else if (type === "transitions") {
        const data = await analyticsService.getTransitionMatrix(days);
        csv = "from_event,to_event,count,unique_users\n";
        data.forEach((r) => {
          csv += `${escapeCsv(r.from_event)},${escapeCsv(r.to_event)},${r.count},${r.unique_users}\n`;
        });
        filename = `transitions-${days}d.csv`;
      } else if (type === "flow-combinations") {
        const data = await analyticsService.getFlowCombinations(days);
        csv = "sequence,steps_count,occurrences,unique_users\n";
        data.forEach((r) => {
          csv += `${escapeCsv(r.sequence_key)},${r.steps.length},${r.total_occurrences},${r.unique_users}\n`;
        });
        filename = `flow-combinations-${days}d.csv`;
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      // Add BOM for Excel UTF-8 recognition
      res.send("\uFEFF" + csv);
    } catch (err) {
      console.error("[analytics] Export error:", (err as Error).message);
      res.status(500).json({ error: "Export failed" });
    }
  }
}

export const analyticsController = new AnalyticsController();
