import { Request, Response, NextFunction } from 'express';
import { aiSuggestService } from '../services/ai-suggest.service.js';

export async function aiSuggestHandler(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const userId = req.user!.userId;
    const { category, profile_based, locale, count } = req.body;

    let suggestions;
    if (profile_based) {
      suggestions = await aiSuggestService.getProfileBasedSuggestions(userId, locale, count);
    } else if (category) {
      suggestions = await aiSuggestService.getCachedSuggestions(category, locale, count);
    } else {
      return res.status(400).json({ error: 'category or profile_based required' });
    }

    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
}
