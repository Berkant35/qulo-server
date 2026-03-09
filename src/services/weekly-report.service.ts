import { supabase } from '../config/supabase.js';
import { NotificationService } from './notification.service.js';
import { questionService } from './question.service.js';

class WeeklyReportService {
  async sendWeeklyReports() {
    const { data: users } = await supabase
      .from('users')
      .select('id, locale')
      .eq('is_deleted', false);

    let sent = 0;
    for (const user of users ?? []) {
      try {
        const report = await questionService.getWeeklyReport(user.id);
        if (report.total_solves === 0) continue;

        const locale = user.locale ?? 'tr';
        const body = locale === 'tr'
          ? `Bu hafta soruların ${report.total_solves} kez çözüldü, ${report.green_earned} yeşil elmas kazandın!`
          : `Your questions were solved ${report.total_solves} times this week, you earned ${report.green_earned} green diamonds!`;

        await NotificationService.sendPush(user.id, 'campaign', {
          body,
        }, undefined, {
          title: locale === 'tr' ? 'Haftalık Raporun' : 'Weekly Report',
          actionUrl: '/profile/questions/analytics',
        });
        sent++;
      } catch {
        // Skip failed users
      }
    }
    return { sent };
  }
}

export const weeklyReportService = new WeeklyReportService();
