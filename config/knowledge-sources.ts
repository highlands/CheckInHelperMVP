export type KnowledgeSourceSeed = {
  pageIdOrUrl: string;
  category?: string;
  audience?: string;
  classification?: string;
};

/** Approved Confluence pages registered for indexing and assistant training. */
export const KNOWLEDGE_SOURCES: KnowledgeSourceSeed[] = [
  {
    pageIdOrUrl:
      "https://churchofthehighlands.atlassian.net/wiki/external/ZDkyNjRlMWEyYmM2NGY4MmE5ZTA4NTliZWVmNGI2ZWM",
  },
  {
    pageIdOrUrl:
      "https://churchofthehighlands.atlassian.net/wiki/external/OTQ3MzQ4OWQyODc4NDA4ZDkwOGQxODI3YjVmYzNiZWQ",
    category: "Rock",
  },
  {
    pageIdOrUrl:
      "https://churchofthehighlands.atlassian.net/wiki/external/YWZjODA0ZjVlMWQ0NGM4NmEyZjdjNmIwYjUwMjVkMGY",
  },
];
