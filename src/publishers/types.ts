import type { GeneratedArticle } from "../content/generator.js";

export interface PublishResult {
  platform: string;
  success: boolean;
  url?: string;
  error?: string;
  tweetId?: string;
}

export interface IPublisher {
  platform: string;
  publish(article: GeneratedArticle, dryRun?: boolean): Promise<PublishResult>;
}
