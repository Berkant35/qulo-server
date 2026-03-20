import type { Request, Response } from 'express';
import { supabase } from '../config/supabase.js';
import {
  createQuestionBankSchema,
  bulkCreateQuestionBankSchema,
  updateQuestionBankSchema,
  listQuestionBankSchema,
} from '../validators/question-bank.validator.js';

class QuestionBankController {
  async page(req: Request, res: Response) {
    res.render('question-bank', { session: req.session });
  }

  async list(req: Request, res: Response) {
    try {
      const params = listQuestionBankSchema.parse(req.query);
      const { page, limit, sort, order, locale, category, tone, is_active } = params;
      const offset = (page - 1) * limit;

      let query = supabase.from('ai_question_bank').select('*', { count: 'exact' });

      if (locale) query = query.eq('locale', locale);
      if (category) query = query.eq('category', category);
      if (tone) query = query.eq('tone', tone);
      if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');

      if (sort === 'acceptance_rate') {
        const { data, error, count } = await query;
        if (error) return res.status(500).json({ error: 'DB error' });

        const withRate = (data ?? []).map((q: any) => ({
          ...q,
          acceptance_rate: q.shown_count > 0
            ? Math.round((q.selected_count / q.shown_count) * 100) / 100
            : null,
        }));
        withRate.sort((a: any, b: any) => {
          const aRate = a.acceptance_rate ?? -1;
          const bRate = b.acceptance_rate ?? -1;
          return order === 'desc' ? bRate - aRate : aRate - bRate;
        });

        return res.json({
          data: withRate.slice(offset, offset + limit),
          pagination: { page, limit, total: count ?? 0 },
        });
      }

      query = query.order(sort, { ascending: order === 'asc' });
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return res.status(500).json({ error: 'DB error' });

      const withRate = (data ?? []).map((q: any) => ({
        ...q,
        acceptance_rate: q.shown_count > 0
          ? Math.round((q.selected_count / q.shown_count) * 100) / 100
          : null,
      }));

      res.json({
        data: withRate,
        pagination: { page, limit, total: count ?? 0 },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const input = createQuestionBankSchema.parse(req.body);
      const { data, error } = await supabase
        .from('ai_question_bank')
        .insert(input)
        .select('*')
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Duplicate question for this locale' });
        }
        return res.status(500).json({ error: 'DB error' });
      }
      res.status(201).json(data);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async bulkCreate(req: Request, res: Response) {
    try {
      const { questions } = bulkCreateQuestionBankSchema.parse(req.body);
      const { data, error } = await supabase
        .from('ai_question_bank')
        .insert(questions)
        .select('id');

      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ inserted: data?.length ?? 0 });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const input = updateQuestionBankSchema.parse(req.body);
      const updateData = { ...input, updated_at: new Date().toISOString() };

      const { data, error } = await supabase
        .from('ai_question_bank')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: 'DB error' });
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const id = req.params.id;
      const { error } = await supabase
        .from('ai_question_bank')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) return res.status(500).json({ error: 'DB error' });
      res.json({ message: 'Deactivated' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}

export const questionBankController = new QuestionBankController();
