import * as cheerio from 'cheerio';

export type OgeResponse = {
  title: string;
  description?: string;
  keywords: string[];
  language: string;
  image?: string;
  createdDate: Date | null;
  publishedDate: Date | null;
  modifiedDate: Date | null;
  expirationDate: Date | null;
  author: {
    name: string;
    url?: string;
  } | null;
  publication: {
    name: string;
    url?: string;
  } | null;
  // raw data
  og: Partial<{
    title: string;
    description: string;
    image: string;
    imageUrl: string;
    imageSecureUrl: string;
    imageType: string;
    imageWidth: string;
    imageHeight: string;
    imageAlt: string;
    type: string;
    url: string;
    siteName: string;
    locale: string;
    localeAlternate: string[];
    determiner: string;
    audio: string;
    video: string;
  }>,
  twitter: Partial<{
    title: string;
    description: string;
    card: string;
    image: string;
    imageAlt: string;
    site: string;
    siteId: string;
    creator: string;
    creatorId: string;
    label1: string;
    data1: string;
    label2: string;
    data2: string;
  }>,
  linkedData: LdNode | null,
}

// https://json-ld.org/ values can be strings, objects, or arrays, so keep it loose
type LdNode = Record<string, any>;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toDate(value: string | undefined | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function resolveURL(value: string | undefined, base: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value, base).href;
  } catch (err) {
    return value;
  }
}

export function parse(body: string, url: string): OgeResponse {
  const $ = cheerio.load(body);

  // HTML meta names are ASCII case-insensitive, and Open Graph (property) and
  // Twitter (name) tags are written with either attribute in the wild
  const metas = new Map<string, string[]>();
  $('meta').each((_, el) => {
    const content = $(el).attr('content')?.trim();
    if (!content) {
      return;
    }
    for (const attr of ['name', 'property']) {
      const key = $(el).attr(attr)?.trim().toLowerCase();
      if (key) {
        metas.set(key, [...(metas.get(key) ?? []), content]);
      }
    }
  });

  function meta(...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = metas.get(key)?.[0];
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  function metaAll(key: string): string[] {
    return metas.get(key) ?? [];
  }

  // https://json-ld.org/ a page can have many blocks, each one an object, an array, or have a @graph
  const linkedDataBlocks: LdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      linkedDataBlocks.push(JSON.parse($(el).html()!));
    } catch (err) {
      // ignore malformed block
    }
  });

  const linkedData = linkedDataBlocks.find(block => block && typeof block === 'object') ?? null;

  const nodes: LdNode[] = [];
  function collect(value: unknown) {
    for (const item of asArray(value as LdNode | LdNode[])) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      nodes.push(item);
      collect(item['@graph']);
    }
  }
  linkedDataBlocks.forEach(collect);

  const nodesById = new Map<string, LdNode>();
  for (const node of nodes) {
    if (typeof node['@id'] === 'string') {
      nodesById.set(node['@id'], node);
    }
  }

  // a node can be just a reference: { "@id": "..." }
  function deref(value: any): any {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['@id'] === 'string' && Object.keys(value).length === 1) {
      return nodesById.get(value['@id']) ?? value;
    }
    return value;
  }

  function hasType(node: LdNode, predicate: (type: string) => boolean) {
    return asArray<string>(node['@type']).some(type => typeof type === 'string' && predicate(type));
  }

  const isArticle = (type: string) => type.endsWith('Article') || type === 'BlogPosting' || type === 'Report';
  const article = nodes.find(node => hasType(node, isArticle));
  // the node to read dates and descriptions from
  const primary = article ?? (linkedData && !Array.isArray(linkedData) ? linkedData : undefined) ?? nodes[0];

  function ldString(value: any): string | undefined {
    value = deref(Array.isArray(value) ? value[0] : value);
    if (typeof value === 'string') {
      return value.trim() || undefined;
    }
    if (value && typeof value === 'object') {
      return ldString(value.name ?? value.url);
    }
    return undefined;
  }

  function ldImage(value: any): string | undefined {
    value = deref(Array.isArray(value) ? value[0] : value);
    if (typeof value === 'string') {
      return value.trim() || undefined;
    }
    if (value && typeof value === 'object') {
      return ldImage(value.url ?? value.contentUrl);
    }
    return undefined;
  }

  function ldEntity(value: any): { name: string; url?: string } | null {
    value = deref(Array.isArray(value) ? value[0] : value);
    if (typeof value === 'string' && value.trim()) {
      return { name: value.trim() };
    }
    if (value && typeof value === 'object' && typeof value.name === 'string' && value.name.trim()) {
      return { name: value.name.trim(), url: typeof value.url === 'string' ? value.url : undefined };
    }
    return null;
  }

  function ldKeywords(value: any): string[] {
    const keywords = asArray(value).flatMap(keyword => typeof keyword === 'string' ? keyword.split(',') : []);
    // Medium
    const tags = keywords.filter(keyword => keyword.includes('Tag:'));
    return unique(tags.length > 0 ? tags.map(keyword => keyword.replace('Tag:', '')) : keywords);
  }

  const ogTitle = meta('og:title');
  const ogImage = meta('og:image');

  const title = ogTitle ?? meta('twitter:title') ?? $('head title').first().text().trim();
  const description = meta('description') ?? meta('og:description') ?? meta('twitter:description') ?? ldString(primary?.description);

  const image = resolveURL(
    ogImage ??
    meta('og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src') ??
    ldImage(primary?.image) ??
    $('img').first().attr('src'),
    url,
  );

  const language =
    $('html').attr('lang')?.trim() ||
    meta('og:locale')?.replace('_', '-') ||
    ldString(primary?.inLanguage) ||
    'en';

  function getKeywords(): string[] {
    const metaKeywords = meta('keywords');
    if (metaKeywords) {
      return unique(metaKeywords.split(','));
    }

    const tags = metaAll('article:tag');
    if (tags.length > 0) {
      return unique(tags);
    }

    return ldKeywords(primary?.keywords);
  }

  function getAuthor(): OgeResponse['author'] {
    // https://ogp.me/#type_article article:author is a profile URL
    const profileURL = metaAll('article:author').find(value => /^https?:\/\//.test(value));

    const author = ldEntity(primary?.author);
    if (author) {
      return { name: author.name, url: author.url ?? profileURL };
    }

    // CSS tricks
    const person = nodes.find(node => hasType(node, type => type === 'Person'));
    const personEntity = person && ldEntity(person);
    if (personEntity) {
      return { name: personEntity.name, url: personEntity.url ?? profileURL };
    }

    const metaAuthor = meta('author');
    if (metaAuthor) {
      return { name: metaAuthor, url: profileURL };
    }

    const twitterCreator = meta('twitter:creator');
    if (twitterCreator) {
      return {
        name: twitterCreator,
        url: `https://twitter.com/${twitterCreator.replace(/^@/, '')}`,
      };
    }

    return null;
  }

  function getPublication(): OgeResponse['publication'] {
    const publisher = ldEntity(primary?.publisher);
    if (publisher) {
      return publisher;
    }

    // CSS Tricks
    const website = nodes.find(node => hasType(node, type => type.toLowerCase() === 'website'));
    const websiteEntity = website && ldEntity(website);
    if (websiteEntity) {
      return websiteEntity;
    }

    const siteName = meta('og:site_name') ?? meta('application-name');
    if (siteName) {
      return { name: siteName };
    }

    return null;
  }

  return {
    title,
    description,
    keywords: getKeywords(),
    language,
    createdDate: toDate(ldString(primary?.dateCreated)),
    publishedDate: toDate(meta('article:published_time') ?? ldString(primary?.datePublished)),
    modifiedDate: toDate(meta('article:modified_time', 'og:updated_time') ?? ldString(primary?.dateModified)),
    expirationDate: toDate(meta('article:expiration_time') ?? ldString(primary?.expires)),
    image,
    author: getAuthor(),
    publication: getPublication(),
    // raw data
    og: {
      title: ogTitle,
      description: meta('og:description'),
      type: meta('og:type'),
      url: meta('og:url'),
      image: ogImage,
      imageUrl: meta('og:image:url'),
      imageSecureUrl: meta('og:image:secure_url'),
      imageType: meta('og:image:type'),
      imageWidth: meta('og:image:width'),
      imageHeight: meta('og:image:height'),
      imageAlt: meta('og:image:alt'),
      siteName: meta('og:site_name'),
      locale: meta('og:locale'),
      localeAlternate: metaAll('og:locale:alternate').length > 0 ? metaAll('og:locale:alternate') : undefined,
      determiner: meta('og:determiner'),
      audio: meta('og:audio'),
      video: meta('og:video'),
    },
    twitter: {
      title: meta('twitter:title'),
      description: meta('twitter:description'),
      card: meta('twitter:card'),
      image: meta('twitter:image'),
      imageAlt: meta('twitter:image:alt'),
      site: meta('twitter:site'),
      siteId: meta('twitter:site:id'),
      creator: meta('twitter:creator'),
      creatorId: meta('twitter:creator:id'),
      label1: meta('twitter:label1'),
      data1: meta('twitter:data1'),
      label2: meta('twitter:label2'),
      data2: meta('twitter:data2'),
    },
    linkedData,
  };
}
