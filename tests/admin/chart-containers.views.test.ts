import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chart.js `responsive` + `maintainAspectRatio: false` yuksekligi canvas'in EBEVEYNINDEN alir.
 * Canvas dogrudan `.card` icindeyse grid satiri karti uzattikca grafik de uzar ve sayfa asagi
 * kayar (/admin/analytics, 2026-10-10). Her canvas sabit yukseklikli `.chart-box` icinde olmali.
 */
const VIEWS = join(process.cwd(), 'src', 'admin', 'views');
const views = readdirSync(VIEWS).filter((f) => f.endsWith('.ejs'));

describe('admin gorunumleri — grafik kapsayicisi', () => {
  it('canvas olan gorunumler var (test bos gecmesin)', () => {
    expect(views.some((f) => readFileSync(join(VIEWS, f), 'utf8').includes('<canvas'))).toBe(true);
  });

  it.each(views)('%s: her <canvas> yuksekligi sabit bir .chart-box icinde', (file) => {
    const html = readFileSync(join(VIEWS, file), 'utf8');
    const ciplak = [...html.matchAll(/(<div[^>]*>)?\s*<canvas[^>]*>/g)].filter(
      ([, ebeveyn]) => !ebeveyn || !/class="chart-box"/.test(ebeveyn) || !/height:\s*\d+px/.test(ebeveyn),
    );
    expect(ciplak.map(([m]) => m.trim())).toEqual([]);
  });
});
