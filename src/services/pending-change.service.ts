import { supabase } from '../config/supabase.js';
import { Errors } from '../utils/errors.js';

class PendingChangeService {
  async hasActiveQuiz(userId: string): Promise<boolean> {
    const { count } = await supabase
      .from('quiz_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('target_id', userId)
      .eq('status', 'IN_PROGRESS');
    return (count ?? 0) > 0;
  }

  async queueChange(userId: string, orderNum: number, changeType: 'UPDATE' | 'DELETE', payload?: any) {
    const { data: question } = await supabase
      .from('questions')
      .select('id')
      .eq('user_id', userId)
      .eq('order_num', orderNum)
      .single();

    if (!question) throw Errors.SESSION_NOT_FOUND();

    // Cancel any existing pending change for this question
    await supabase
      .from('question_pending_changes')
      .update({ status: 'CANCELLED' })
      .eq('question_id', question.id)
      .eq('status', 'PENDING');

    const { data, error } = await supabase
      .from('question_pending_changes')
      .insert({
        question_id: question.id,
        user_id: userId,
        change_type: changeType,
        payload: changeType === 'UPDATE' ? payload : null,
        status: 'PENDING',
      })
      .select()
      .single();

    if (error) throw Errors.SERVER_ERROR();
    return data;
  }

  async getPendingChanges(userId: string) {
    const { data, error } = await supabase
      .from('question_pending_changes')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    if (error) throw Errors.SERVER_ERROR();
    return data ?? [];
  }

  async cancelPendingChange(userId: string, changeId: string) {
    const { data, error } = await supabase
      .from('question_pending_changes')
      .update({ status: 'CANCELLED' })
      .eq('id', changeId)
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .select()
      .single();

    if (error || !data) throw Errors.SESSION_NOT_FOUND();
    return data;
  }

  async applyPendingChanges(userId: string) {
    const pending = await this.getPendingChanges(userId);
    if (pending.length === 0) return;

    for (const change of pending) {
      try {
        if (change.change_type === 'DELETE') {
          await supabase
            .from('questions')
            .delete()
            .eq('id', change.question_id);
        } else if (change.change_type === 'UPDATE' && change.payload) {
          await supabase
            .from('questions')
            .update(change.payload)
            .eq('id', change.question_id);
        }

        await supabase
          .from('question_pending_changes')
          .update({ status: 'APPLIED', applied_at: new Date().toISOString() })
          .eq('id', change.id);
      } catch {
        // If question was already deleted, skip silently
      }
    }
  }
}

export const pendingChangeService = new PendingChangeService();
