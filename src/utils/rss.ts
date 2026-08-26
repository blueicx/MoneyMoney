export interface RssNewsItem {
  title: string;
  link: string;
  date: string;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRssItems(xml: string, limit = 10): RssNewsItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const items: RssNewsItem[] = [];

  for (const block of blocks) {
    if (items.length >= limit) break;

    const readTag = (name: string): string => {
      const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
      return match ? decodeXmlText(match[1]) : '';
    };

    const title = readTag('title');
    if (!title) continue;

    let link = readTag('link');
    if (!link) {
      const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      link = atomLink ? decodeXmlText(atomLink[1]) : '#';
    }

    const pubDate = readTag('pubDate');
    const parsedDate = pubDate ? new Date(pubDate) : null;

    items.push({
      title,
      link,
      date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : '',
    });
  }

  return items;
}
