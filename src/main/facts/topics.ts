// Spec 07 §4.6 — stage 5. WORKER (§10.2).
//
// No fixed topic list: a review tool cannot know in advance what it will be
// pointed at. The field agrees — GraphRAG derives topics by running community
// detection over the graph and then asking a model to name each community.

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Db } from "../db/database.ts";
import type { Gateway } from "./gateway.ts";
import { coOccurrences, setTopic, subjectLabels } from "./store.ts";

/** §4.6 — "the 20 highest-degree subjects in that community". */
const SUBJECTS_PER_NAME = 20;

/**
 * A community smaller than this is not a topic, it is a pair of subjects that
 * happened to share a paragraph. Naming it costs a whole model call and produces
 * a heading nobody wants in the lens.
 */
const MIN_COMMUNITY = 3;

const TOPIC_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string" } },
};

const TOPIC_SYSTEM_PROMPT = `You name a group of related subjects taken from a set of technical documents.

Return a short name for what the group is about: two to four words, in the
document's own vocabulary, with no punctuation and no explanation. It is a
heading in a list, not a sentence.

Good: "storage and schema", "agent permissions", "build and packaging".
Bad: "This group is about how the system stores data."`;

/**
 * A deterministic pseudo-random source.
 *
 * Louvain is only deterministic for a fixed node order *and* a fixed random
 * source; the library's default is `Math.random`, so two builds over an
 * unchanged corpus would return different community ids for no reason and every
 * topic in the lens would be renamed. §4.6 asks for the node order to be sorted;
 * this is the other half of the same requirement.
 */
function seededRandom(): () => number {
  let state = 0x2f6e2b1;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

export interface TopicCounts {
  communities: number;
  named: number;
  subjects: number;
}

/**
 * Runs Louvain over the **co-occurrence** graph, not the claim graph.
 *
 * The claim graph is nearly edgeless — only contradictions and refinements
 * connect anything — and community detection over an edgeless graph returns
 * noise. The co-occurrence graph built in stage 3 is dense enough to have real
 * structure.
 *
 * In main memory with `graphology`: at the §7.3 ceiling that is about 8,000
 * nodes and 150,000 edges, well under 100 MB and under a second to load.
 * `graphology` is the graph engine in this design; SQLite only stores the rows.
 */
export async function assignTopics(
  db: Db,
  gateway: Gateway,
  root: string,
  alias: string,
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<TopicCounts> {
  const labels = subjectLabels(db, root);
  const edges = coOccurrences(db, root);
  if (labels.size === 0) return { communities: 0, named: 0, subjects: 0 };

  const graph = new Graph({ type: "undirected" });
  // §4.6 — "sort the nodes by id before feeding them in, or the topic ids churn
  // between builds for no reason". Every subject is added, including one that
  // co-occurs with nothing: it is its own community, which is the honest answer.
  for (const id of [...labels.keys()].sort()) graph.addNode(id);
  for (const edge of edges) {
    if (!graph.hasNode(edge.a) || !graph.hasNode(edge.b)) continue;
    graph.mergeEdge(edge.a, edge.b, { weight: edge.count });
  }

  const communities: Record<string, number> = louvain(graph, {
    getEdgeWeight: "weight",
    randomWalk: false,
    rng: seededRandom(),
  });

  const members = new Map<number, string[]>();
  for (const [subjectId, community] of Object.entries(communities)) {
    const found = members.get(community);
    if (found) found.push(subjectId);
    else members.set(community, [subjectId]);
  }

  // Sorted by size so topic 0 is the largest, and so the ids are stable rather
  // than being whatever order the object happened to enumerate in.
  const ordered = [...members.entries()]
    .map(([, subjectIds]) => subjectIds.sort())
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  const counts: TopicCounts = { communities: ordered.length, named: 0, subjects: 0 };

  for (const [topicId, subjectIds] of ordered.entries()) {
    if (cancelled()) break;
    onProgress(topicId, ordered.length);

    let name = `Topic ${topicId + 1}`;
    if (subjectIds.length >= MIN_COMMUNITY) {
      // §4.6 — the highest-degree subjects, which are the ones that characterise
      // the community rather than sit at its edge.
      const prominent = subjectIds
        .slice()
        .sort((a, b) => graph.degree(b) - graph.degree(a))
        .slice(0, SUBJECTS_PER_NAME)
        .map((id) => labels.get(id) ?? id);

      try {
        const { value } = await gateway.chat({
          alias,
          system: TOPIC_SYSTEM_PROMPT,
          user: `SUBJECTS:\n${prominent.map((label) => `- ${label}`).join("\n")}`,
          schema: TOPIC_SCHEMA,
          schemaName: "topic",
          maxTokens: 2048,
          parse: (parsed) => {
            const candidate = (parsed as { name?: unknown }).name;
            if (typeof candidate !== "string" || candidate.trim().length === 0) {
              throw new Error("`name` must be a non-empty string");
            }
            return candidate.trim();
          },
        });
        name = value;
        counts.named++;
      } catch {
        // A community that could not be named still exists and still groups its
        // subjects. Losing the whole topic because one call failed would be a
        // worse answer than a numbered heading.
      }
    }

    setTopic(db, subjectIds, topicId, name);
    counts.subjects += subjectIds.length;
  }

  onProgress(ordered.length, ordered.length);
  return counts;
}
