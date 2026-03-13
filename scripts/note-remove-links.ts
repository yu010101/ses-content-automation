import { NoteClient, markdownToNoteHtml } from "../src/publishers/note-client.js";

const NOTE_KEY = "n6affc0efb7b4";
const NOTE_ID = 150923974;

async function main() {
  const client = new NoteClient();

  // Fetch current content via API
  console.log("Fetching current Note article...");
  const headers = await (client as any).apiHeaders();
  const res = await fetch(`https://note.com/api/v3/notes/${NOTE_KEY}`, { headers });
  const data = await res.json();
  const currentBody: string = data?.data?.body ?? "";

  // Remove 関連記事 section from HTML
  // The section looks like: <h2>関連記事</h2><ul><li>...</li></ul>
  let cleanBody = currentBody.replace(/<h2>関連記事<\/h2>[\s\S]*?<\/ul>/g, "");
  // Also remove any remaining sescore/qiita links
  cleanBody = cleanBody.replace(/<a[^>]*qiita\.com\/sescore[^>]*>[\s\S]*?<\/a>/g, "");
  cleanBody = cleanBody.replace(/<li>\s*<\/li>/g, "");

  if (cleanBody === currentBody) {
    console.log("No related links found in Note article, nothing to do.");
    return;
  }

  console.log("Removing related article links...");
  await client.saveDraftContent(NOTE_ID, data?.data?.name ?? "", cleanBody);
  console.log("Done! Related links removed from Note article.");
  await (client as any).close?.();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
