import { discoverTrends } from "./trends/grok.js";

discoverTrends()
  .then((trends) => {
    console.log(`Found ${trends.length} trends:`);
    trends.forEach((t) =>
      console.log(`  - ${t.topic} (score: ${t.relevanceScore}) - ${t.summary}`),
    );
  })
  .catch((e: Error) => console.error("Error:", e.message));
