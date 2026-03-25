# SES Content Automation - Autoresearch

## Overview

Content optimization research for the SES Content Automation pipeline. This document tracks parameter tuning, metrics, and constraints for the automated content generation and distribution system.

## Primary: pipeline.ts

### Similarity Threshold (0.7)

The `checkDiversity()` function compares new article titles against recent articles (last 7 days) using keyword overlap scoring. If any recent title shares 70%+ keyword overlap (`score >= 0.7`), the article is flagged as `isTooSimilar`.

- **Current value**: 0.7 (70% keyword overlap threshold)
- **Location**: `checkDiversity()` at line 121
- **Common keywords checked**: SES, フリーランス, エンジニア, 転職, 年収, 脱出, 転向, 比較, 完全ガイド, 徹底, 最新, 2026
- **Overlap formula**: `overlap / Math.max(titleWords.length, recentWords.length)`
- **Research direction**: Lowering to 0.5-0.6 may improve diversity but risks rejecting valid articles. Raising above 0.8 may allow too-similar content through.

### Learning Ratio (70/30)

The `loadKeywords()` function implements a 70/30 strategy when learning state is available:

- **70% proven keywords**: Up to 3 keywords from `learning.bestKeywords` (historically high-performing)
- **30% exploration**: 2 from `high_conversion` + 3 from `primary/secondary` pools
- **Angle seeds**: Always injects 1-2 random `angle_seeds` for topic diversity
- **Fallback**: When no learning state exists, uses 3 `high_conversion` + 5 `primary/secondary` + 2 angle seeds
- **Research direction**: Testing 60/40 or 80/20 splits to find optimal exploration vs exploitation balance

## Secondary: quote-repost.ts

### Priority Weighting (3:1)

The `selectTarget()` function uses weighted random selection for quote repost targets:

- **High priority**: 3x weight (appears 3 times in the weighted pool)
- **Medium priority**: 1x weight (appears 1 time in the weighted pool)
- **Effective ratio**: High-priority targets are selected ~75% of the time in a balanced list
- **Location**: `selectTarget()` at lines 70-77
- **Research direction**: Testing 2:1 or 4:1 ratios. Current 3:1 may over-concentrate on high-priority targets, limiting network breadth.

### Quote Repost Flow

1. Select target (weighted random from `quote-targets.json`)
2. Search recent tweets via Grok API (48-hour window)
3. Deduplicate against `quote-history.json`
4. Generate quote comment via Claude (140 char limit, no emoji, no CTA)
5. Post via XPublisher
6. Record in history
7. Retry up to 3 different targets on failure

## Metrics

### Article Diversity
- **Keyword overlap score**: Measured per article against 7-day rolling window
- **Angle seed injection**: Ensures at least 1-2 novel topic seeds per generation
- **Duplicate detection**: Exact title match prevention
- **Target**: No two articles within 7 days should exceed 0.7 overlap

### Engagement Rates
- **Learning feedback loop**: `loadLearningState()` tracks best-performing keywords
- **Quote repost**: Targets selected by engagement potential (likes/RT count)
- **Cross-platform linking**: Qiita URLs injected into Zenn/Note for cross-pollination
- **X variations**: Post variations generated and queued for staggered distribution

## Constraints

- **TypeScript project**: All source in `src/`, compiled via standard TS toolchain
- **Keep existing interfaces**: `PublishedRecord`, `DiversityCheck`, `QuoteTarget`, `QuoteHistoryEntry`, `QuoteHistory`, `FoundTweet`, `GeneratedArticle`, `PublishResult` must remain stable
- **External API dependencies**: Claude (content generation), Grok/xAI (trend discovery, tweet search), Telegram (approval), Qiita/Zenn/Note/X (publishing)
- **Data files**: `data/keywords.json`, `data/published.json`, `data/quote-targets.json`, `data/quote-history.json`
