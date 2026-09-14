/**
 * Non-negotiable #5 — object storage behind our own interface.
 *
 * Keys encode region/org/kind/id and carry no location. The day the storage
 * vendor changes, or a region has to be pinned for data residency, this is the
 * difference between a config change and a data migration with photos in it.
 */
const BANNED = [/^fs$/, /^node:fs/, /^@aws-sdk\/client-s3$/, /^@google-cloud\/storage$/, /^minio$/];

export default {
  meta: {
    type: "problem",
    docs: { description: "file and blob access goes through @ac/storage" },
    schema: [],
    messages: {
      banned: "{{name}} is only importable inside packages/storage. Elsewhere, use a StorageKey.",
      url: "A vendor storage URL is hard-coded here. Keys carry no host, no bucket, no vendor.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (BANNED.some((re) => re.test(node.source.value))) {
          context.report({ node, messageId: "banned", data: { name: node.source.value } });
        }
      },
      Literal(node) {
        if (typeof node.value === "string" && /(s3\.amazonaws\.com|blob\.core\.windows\.net|storage\.googleapis\.com|r2\.cloudflarestorage\.com)/.test(node.value)) {
          context.report({ node, messageId: "url" });
        }
      },
    };
  },
};
