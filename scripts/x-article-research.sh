#!/bin/bash
# X記事バズリサーチ — SocialData API (curlベース)
MIN_FAVES="${1:-500}"
QUERY="${2:-}"
API_KEY="6184|4WZlK9nimz6aovRy7t0FmqxBxJJR44E5uXiYwe8Sdf38a27a"
OUTPUT_DIR="$HOME/ses-content-automation/data/x-research"
mkdir -p "$OUTPUT_DIR"

SEARCH="url:x.com/i/article min_faves:${MIN_FAVES} -filter:replies"
[ -n "$QUERY" ] && SEARCH="url:x.com/i/article (${QUERY}) min_faves:${MIN_FAVES} -filter:replies"

echo "リサーチ: $SEARCH"

/usr/bin/curl -s -G "https://api.socialdata.tools/twitter/search" \
  --data-urlencode "query=$SEARCH" \
  --data-urlencode "type=Latest" \
  -H "Authorization: Bearer $API_KEY" \
  -o /tmp/x-research-result.json 2>&1

python3 -c "
import json, re, os
from datetime import datetime
with open('/tmp/x-research-result.json') as f:
    data = json.load(f)
tweets = data.get('tweets', [])
jp_pat = re.compile(r'[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]')
jp = []
for t in tweets:
    u = t.get('user', {})
    if jp_pat.search(u.get('name','') + u.get('description','')):
        jp.append({'user':u.get('screen_name'),'name':u.get('name','')[:20],'likes':t.get('favorite_count',0),'views':t.get('views_count',0),'bookmarks':t.get('bookmark_count',0),'url':f\"https://x.com/{u.get('screen_name')}/status/{t.get('id_str')}\"})
jp.sort(key=lambda x: -x['likes'])
print(f'全{len(tweets)}件→日本語{len(jp)}件')
for i,a in enumerate(jp[:10]):
    print(f\"{i+1}. ❤{a['likes']:,} 👁{a['views']:,} @{a['user']} ({a['name']})\")
os.makedirs('$OUTPUT_DIR', exist_ok=True)
with open('$OUTPUT_DIR/latest.json','w') as f:
    json.dump({'jp_articles':jp,'total':len(tweets),'jp_count':len(jp),'researched_at':datetime.now().isoformat()},f,ensure_ascii=False,indent=2)
"
