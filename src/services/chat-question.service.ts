import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { assertUuid } from "../utils/validation.js";
import { diamondService } from "./diamond.service.js";
import { matchingService } from "./matching.service.js";
import { NotificationService } from "./notification.service.js";

interface Match {
  id: string;
  user1_id: string;
  user2_id: string;
  is_active: boolean;
}

const DAILY_QUESTION_LIMIT = 2;
const DAILY_UNMATCH_RISK_LIMIT = 1;
const NORMAL_QUESTION_COST = 5;
const UNMATCH_RISK_COST = 15;

export class ChatQuestionService {
  private async verifyMatchAccess(userId: string, matchId: string): Promise<Match> {
    assertUuid(userId, "userId");
    assertUuid(matchId, "matchId");

    const { data: match, error } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, is_active")
      .eq("id", matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (error || !match) {
      throw Errors.NOT_MATCHED();
    }

    if (!match.is_active) {
      throw Errors.MATCH_INACTIVE();
    }

    return match as Match;
  }

  async createQuestion(
    matchId: string,
    senderId: string,
    data: {
      question_text: string;
      option_a: string;
      option_b: string;
      correct_option: "A" | "B";
      has_unmatch_risk: boolean;
    },
  ) {
    const match = await this.verifyMatchAccess(senderId, matchId);

    // Check daily limits — questions sent today in this match
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayQuestions, error: countErr } = await supabase
      .from("chat_questions")
      .select("id, has_unmatch_risk")
      .eq("match_id", matchId)
      .eq("sender_id", senderId)
      .gte("created_at", todayStart.toISOString());

    if (countErr) {
      console.error("[chat-question] Daily limit check error:", countErr);
      throw Errors.SERVER_ERROR();
    }

    const questionsToday = todayQuestions?.length ?? 0;
    if (questionsToday >= DAILY_QUESTION_LIMIT) {
      throw Errors.DAILY_LIMIT_EXCEEDED("chat_questions");
    }

    if (data.has_unmatch_risk) {
      const unmatchRiskToday = (todayQuestions ?? []).filter((q) => q.has_unmatch_risk).length;
      if (unmatchRiskToday >= DAILY_UNMATCH_RISK_LIMIT) {
        throw Errors.DAILY_LIMIT_EXCEEDED("unmatch_risk_questions");
      }
    }

    // Deduct diamonds
    const cost = data.has_unmatch_risk ? UNMATCH_RISK_COST : NORMAL_QUESTION_COST;
    await diamondService.spendPurple(senderId, cost, "chat_question", matchId);

    // Insert question
    const { data: question, error: insertErr } = await supabase
      .from("chat_questions")
      .insert({
        match_id: matchId,
        sender_id: senderId,
        question_text: data.question_text,
        option_a: data.option_a,
        option_b: data.option_b,
        correct_option: data.correct_option,
        has_unmatch_risk: data.has_unmatch_risk,
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error("[chat-question] Insert error:", insertErr);
      throw Errors.SERVER_ERROR();
    }

    // Send push to other user (fire-and-forget)
    const otherUserId = match.user1_id === senderId ? match.user2_id : match.user1_id;
    NotificationService.sendPush(otherUserId, "new_message", {}, undefined, {
      actionUrl: `/matches/chat/${matchId}`,
    }).catch(() => {});

    return question;
  }

  async answerQuestion(questionId: string, userId: string, selectedOption: "A" | "B") {
    assertUuid(questionId, "questionId");
    assertUuid(userId, "userId");

    // Fetch question
    const { data: question, error: fetchErr } = await supabase
      .from("chat_questions")
      .select("*")
      .eq("id", questionId)
      .single();

    if (fetchErr || !question) {
      throw Errors.SESSION_NOT_FOUND();
    }

    // Cannot answer own question
    if (question.sender_id === userId) {
      throw Errors.VALIDATION_ERROR({ sender: "Cannot answer your own question" });
    }

    // Already answered
    if (question.answered_option != null) {
      throw Errors.ALREADY_ANSWERED();
    }

    // Verify match access
    const match = await this.verifyMatchAccess(userId, question.match_id as string);

    // Determine correctness
    const isCorrect = selectedOption === question.correct_option;

    // Update question
    const { data: updated, error: updateErr } = await supabase
      .from("chat_questions")
      .update({
        answered_option: selectedOption,
        is_correct: isCorrect,
        answered_at: new Date().toISOString(),
      })
      .eq("id", questionId)
      .select("*")
      .single();

    if (updateErr) {
      console.error("[chat-question] Answer update error:", updateErr);
      throw Errors.SERVER_ERROR();
    }

    let unmatched = false;

    // If wrong + unmatch risk → unmatch
    if (!isCorrect && question.has_unmatch_risk) {
      try {
        // Use sender to unmatch (the one who created the risky question)
        await matchingService.unmatch(question.sender_id as string, match.id);
        unmatched = true;
      } catch (err) {
        console.error("[chat-question] Unmatch after wrong answer failed:", err);
      }
    }

    return {
      question: updated,
      is_correct: isCorrect,
      unmatched,
    };
  }
}

export const chatQuestionService = new ChatQuestionService();
