import { NowRequest, NowResponse } from '@now/node';
import got from 'got';
import cheerio from 'cheerio';

type OgeResponse = {
  title: string;
  description?: string;
  keywords?: string[];
  language: string;
  image?: string;
  createdDate: Date | null;
  publishedDate: Date | null;
  modifiedDate: Date | null;
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
    type: string;
    url: string;
  }>,
  twitter: Partial<{
    title: string;
    description: string;
    card: string;
    image: string;
    imageAlt: string;
    label1: string;
    data1: string;
    label2: string;
    data2: string;
  }>,
  linkedData: LinkedData | null,
}

type OrganizationDataGraph = {
  '@type': 'Organization';
  name: string;
  url: string;
}

type WebsiteDataGraph = {
  '@type': 'WebSite';
  name: string;
  url: string;
}

type ArticleDataGraph = {
  '@type': 'Article';
  keywords: string;
}

type PersonDataGraph = {
  '@type': ['Person'] | 'Person';
  name: string;
}

type LinkedDataGraph = OrganizationDataGraph | WebsiteDataGraph | ArticleDataGraph | PersonDataGraph;

type LinkedData = Partial<{
  '@context': string;
  '@type': string;
  image: Array<string>
  author: {
    '@type': string;
    name: string;
    url: string;
  };
  '@graph': Array<LinkedDataGraph>
  creator: Array<string>;
  dateCreated: string;
  dateModified: string;
  datePublished: string;
  description: string;
  headline: string;
  identifier: string;
  keywords: Array<string>;
  mainEntityOfPage: string;
  name: string;
  publisher: {
    '@type': string;
    name: string;
    url: string;
    logo: {
      '@type': string;
      width: number;
      height: number;
      url: string;
    }
  }
  url: string;

}>

export default async function handler(req: NowRequest, res: NowResponse) {
  const url = req.query.url as string;

  try {
    require('url').parse(url);
  } catch (err) {
    res.status(400);
    res.json({ error: 'Invalid URL' });
    return;
  }

  const data = await got(url);
  const $ = cheerio.load(data.body);

  function getMetaByName(value: string) {
    return $(`meta[name="${value}"]`).attr('content');
  }
  function getMetaByProperty(value: string) {
    return $(`meta[property="${value}"]`).attr('content');
  }

  function getLinkedData(): LinkedData | null {
    try {
      const jsonString = $('script[type="application/ld+json"]').html()!;
      return JSON.parse(jsonString) as LinkedData;
    } catch (err) {
      return null;
    }
  }

  const ogTitle = getMetaByProperty('og:title');
  const title = ogTitle ?? $('head title').text();
  const description = getMetaByName('description');
  const language = $('html').attr('lang') ?? 'en';
  const metaKeywords = getMetaByName('keywords');

  // https://ogp.me/#type_article
  const ogPublishedTime = getMetaByProperty('article:published_time');
  const ogModifiedTime = getMetaByProperty('article:modified_time');

  // https://json-ld.org/
  const linkedData = getLinkedData()

  const ogImage = getMetaByProperty('og:image');
  const twitterImage = getMetaByName('twitter:image');
  const image = ogImage ?? twitterImage ?? linkedData?.image?.[0] ?? $('img').attr('src');

  function getKeywords(): Array<string> {
    if (metaKeywords) {
      return metaKeywords
        .split(',')
        .map(key => key.trim())
    }

    // Medium
    if (linkedData?.keywords) {
      // cleanup
      if (url.includes('medium')) {
        return linkedData.keywords
          .filter(key => key.includes('Tag:'))
          .map(key => key.replace('Tag:', ''))
      }

      return linkedData.keywords
    }

    // CSS tricks
    const Article = linkedData?.["@graph"]?.find(graph => {
      return graph['@type'] === 'Article';
    }) as ArticleDataGraph | undefined;

    if (Article?.keywords) {
      return Article.keywords.split(',').map(key => key.trim());
    }

    return [];
  }

  function getAuthor(): OgeResponse['author'] | null {
    // Medium
    if (linkedData?.author) {
      return {
        name: linkedData.author.name,
        url: linkedData.author.url,
      }
    }

    // CSS tricks
    const Person = linkedData?.["@graph"]?.find(graph => {
      if (Array.isArray(graph['@type'])) {
        return graph['@type'][0] === 'Person';
      }
      return graph['@type'] === 'Person';
    }) as PersonDataGraph | undefined;

    if (Person?.name) {
      return {
        name: Person.name,
      }
    }


    const twitterCreator = getMetaByName('twitter:creator');
    if (twitterCreator) {
      return {
        name: twitterCreator,
        url: `https://twitter.com/${twitterCreator.slice(1)}`,
      }
    }

    return null;
  }

  function getPublication(): OgeResponse['publication'] | null {
    if (linkedData?.publisher) {
      return {
        name: linkedData.publisher.name,
        url: linkedData.publisher.url,
      }
    }

    // CSS Tricks
    const Website = linkedData?.["@graph"]?.find(graph => {
      return (graph['@type'] as string)?.toLowerCase() === 'website';
    }) as WebsiteDataGraph | undefined;

    if (Website?.name) {
      return {
        name: Website.name,
        url: Website.url
      }
    }

    return null;
  }

  function getPublishedDate() {
    if (ogPublishedTime) {
      return new Date(ogPublishedTime);
    }

    if (linkedData?.datePublished) {
      return new Date(linkedData.datePublished);
    }

    return null;
  }

  function getModifiedDate() {
    if (ogModifiedTime) {
      return new Date(ogModifiedTime)
    }

    if (linkedData?.dateModified) {
      return new Date(linkedData.dateModified)
    }

    return null;
  }

  function getCreatedDate() {
    if (linkedData?.dateCreated) {
      return new Date(linkedData.dateCreated);
    }

    return null;
  }

  const response: OgeResponse = {
    title,
    description,
    keywords: getKeywords(),
    language,
    createdDate: getCreatedDate(),
    publishedDate: getPublishedDate(),
    modifiedDate: getModifiedDate(),
    image,
    author: getAuthor(),
    publication: getPublication(),
    // raw data
    og: {
      title: ogTitle,
      description: getMetaByProperty('og:description'),
      type: getMetaByProperty('og:type'),
      url: getMetaByProperty('og:url'),
      image: ogImage,
    },
    twitter: {
      title: getMetaByName('twitter:title'),
      description: getMetaByName('twitter:description'),
      card: getMetaByName('twitter:card'),
      image: twitterImage,
      imageAlt: getMetaByName('twitter:image:alt'),
      label1: getMetaByName('twitter:label1'),
      data1: getMetaByName('twitter:data1'),
      label2: getMetaByName('twitter:label2'),
      data2: getMetaByName('twitter:data2'),
    },
    linkedData,
  }

  res.json(response);
}
