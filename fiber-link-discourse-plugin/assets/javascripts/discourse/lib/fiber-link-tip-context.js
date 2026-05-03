const DEFAULT_TOPIC_TITLE = "Community post";
const DEFAULT_POST_SUMMARY = "Support this contributor directly from the conversation.";
const MAX_POST_SUMMARY_LENGTH = 160;

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkup(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(trimmed, "text/html");
    return normalizeWhitespace(doc.body.textContent || "");
  }

  return normalizeWhitespace(trimmed.replace(/<[^>]*>/g, " "));
}

export function buildTipTopicTitle(post) {
  const text = stripMarkup(post?.topic?.title ?? post?.topic_title ?? post?.topicTitle ?? "");
  return text || DEFAULT_TOPIC_TITLE;
}

export function buildTipPostSummary(post) {
  const text = stripMarkup(post?.excerpt ?? post?.cooked_excerpt ?? post?.blurb ?? post?.raw ?? "");
  if (!text) {
    return DEFAULT_POST_SUMMARY;
  }
  if (text.length <= MAX_POST_SUMMARY_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_POST_SUMMARY_LENGTH - 3).trimEnd()}...`;
}
