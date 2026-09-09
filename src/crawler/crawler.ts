import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { URL } from 'url';
import { validateUrlForSSRF, SSRFError } from './ssrfGuard.js';
import { config } from '../config/index.js';

export interface CrawledPage {
  url: string;
  title: string;
  content: string; // Cleaned text
  isHiringOrAbout: boolean;
}

export interface CrawlResult {
  pages: CrawledPage[];
  pagesUsed: string[];
  errors: Array<{ url: string; reason: string }>;
}

export class SafeCrawler {
  private userAgent = 'InterviewPrepKitBot/1.0 (+https://example.com/bot)';

  /**
   * Crawls a company site starting at targetUrl.
   * Discovers internal links, ranks them by relevance to hiring/about/culture, and fetches top candidates.
   */
  async crawlCompanySite(baseUrlStr: string): Promise<CrawlResult> {
    const pages: CrawledPage[] = [];
    const pagesUsed: string[] = [];
    const errors: Array<{ url: string; reason: string }> = [];

    let baseUrl: URL;
    try {
      baseUrl = await validateUrlForSSRF(baseUrlStr);
    } catch (err: any) {
      errors.push({ url: baseUrlStr, reason: err.message });
      return { pages, pagesUsed, errors };
    }

    // 1. Check robots.txt (optional best-effort)
    const robots = await this.fetchRobotsTxt(baseUrl);

    // 2. Fetch root / base page
    try {
      if (robots && !robots.isAllowed(baseUrl.toString(), this.userAgent)) {
        errors.push({ url: baseUrl.toString(), reason: 'Disallowed by robots.txt' });
      } else {
        const rootPage = await this.fetchAndCleanPage(baseUrl.toString());
        if (rootPage) {
          pages.push(rootPage);
          pagesUsed.push(rootPage.url);
        }
      }
    } catch (err: any) {
      errors.push({ url: baseUrl.toString(), reason: err.message });
      // If root page fails, return immediately with error recorded
      return { pages, pagesUsed, errors };
    }

    // If root page was fetched, extract and rank links
    if (pages.length > 0) {
      const discoveredLinks = this.extractAndRankLinks(baseUrl, pages[0].content, pages[0].url);
      
      // Fetch up to (maxCrawlPages - 1) additional high-priority pages
      const linksToFetch = discoveredLinks
        .filter(link => !pagesUsed.includes(link))
        .slice(0, config.maxCrawlPages - 1);

      for (const link of linksToFetch) {
        if (robots && !robots.isAllowed(link, this.userAgent)) {
          continue;
        }
        try {
          await validateUrlForSSRF(link);
          const crawled = await this.fetchAndCleanPage(link);
          if (crawled && crawled.content.trim().length > 50) {
            pages.push(crawled);
            pagesUsed.push(crawled.url);
          }
        } catch (err: any) {
          errors.push({ url: link, reason: err.message });
        }
      }
    }

    return { pages, pagesUsed, errors };
  }

  private async fetchRobotsTxt(baseUrl: URL) {
    try {
      const robotsUrl = new URL('/robots.txt', baseUrl.origin).toString();
      const res = await axios.get(robotsUrl, {
        timeout: 3000,
        headers: { 'User-Agent': this.userAgent },
        validateStatus: status => status === 200,
      });
      return robotsParser(robotsUrl, res.data);
    } catch {
      return null;
    }
  }

  async fetchAndCleanPage(pageUrl: string): Promise<CrawledPage | null> {
    const res: AxiosResponse = await axios.get(pageUrl, {
      timeout: config.crawlerTimeoutMs,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
      maxContentLength: config.maxPageSizeBytes,
      validateStatus: status => status >= 200 && status < 300,
    });

    const contentType = res.headers['content-type'] || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const $ = cheerio.load(html);

    // Remove scripts, styles, iframes, navigation clutter, ads, SVGs
    $('script, style, iframe, noscript, svg, nav, footer, header, form').remove();

    const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
    
    // Extract textual content
    const textBlocks: string[] = [];
    $('p, h1, h2, h3, h4, li, article, section, div').each((_, el) => {
      const directText = $(el).clone().children().remove().end().text().trim();
      if (directText.length > 20) {
        textBlocks.push(directText);
      }
    });

    let cleanedText = textBlocks.join('\n');
    if (cleanedText.length < 50) {
      cleanedText = $('body').text().replace(/\s+/g, ' ').trim();
    }

    // Limit text to 8000 characters to conserve tokens and focus on substance
    if (cleanedText.length > 8000) {
      cleanedText = cleanedText.slice(0, 8000) + '... [truncated]';
    }

    const lower = (title + ' ' + pageUrl + ' ' + cleanedText).toLowerCase();
    const isHiringOrAbout =
      lower.includes('career') ||
      lower.includes('hiring') ||
      lower.includes('job') ||
      lower.includes('interview') ||
      lower.includes('team') ||
      lower.includes('about');

    return {
      url: pageUrl,
      title,
      content: cleanedText,
      isHiringOrAbout,
    };
  }

  /**
   * Extracts links from page HTML and ranks them based on hiring/culture keywords.
   */
  private extractAndRankLinks(baseUrl: URL, rawHtmlOrText: string, currentUrl: string): string[] {
    const $ = cheerio.load(rawHtmlOrText);
    const scoredLinks = new Map<string, number>();

    const targetKeywords: Record<string, number> = {
      careers: 10,
      career: 9,
      jobs: 10,
      hiring: 9,
      handbook: 8,
      interview: 8,
      engineering: 7,
      culture: 7,
      about: 6,
      team: 5,
      work: 4,
    };

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      const linkText = $(el).text().toLowerCase().trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      try {
        // Resolve relative link safely against the base/current URL
        const resolved = new URL(href, currentUrl);

        // Keep strictly on the same host / origin
        if (resolved.origin !== baseUrl.origin) {
          return;
        }

        const pathLower = resolved.pathname.toLowerCase();
        let score = 0;

        for (const [kw, weight] of Object.entries(targetKeywords)) {
          if (pathLower.includes(kw)) score += weight;
          if (linkText.includes(kw)) score += weight;
        }

        // Avoid common noisy paths
        if (
          pathLower.includes('login') ||
          pathLower.includes('signup') ||
          pathLower.includes('terms') ||
          pathLower.includes('privacy') ||
          pathLower.includes('cart') ||
          pathLower.includes('checkout')
        ) {
          score = -10;
        }

        if (score > 0 && resolved.toString() !== currentUrl) {
          const currentScore = scoredLinks.get(resolved.toString()) || 0;
          scoredLinks.set(resolved.toString(), Math.max(currentScore, score));
        }
      } catch {
        // Ignore malformed links
      }
    });

    return Array.from(scoredLinks.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
  }
}
