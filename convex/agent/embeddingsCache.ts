import { v } from 'convex/values';
import { ActionCtx, internalMutation, internalQuery, QueryCtx, MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { fetchEmbeddingBatch } from '../util/llm';

const selfInternal = internal.agent.embeddingsCache;

export async function fetch(ctx: ActionCtx, text: string) {
  const result = await fetchBatch(ctx, [text]);
  return result.embeddings[0];
}

export async function fetchBatch(ctx: ActionCtx, texts: string[]) {
  try {
  const start = Date.now();

  const textHashes = await Promise.all(texts.map((text) => hashText(text)));
  const results = new Array<number[]>(texts.length);
  const cacheResults = await ctx.runQuery(selfInternal.getEmbeddingsByText, {
    textHashes,
  });
  for (const { index, embedding } of cacheResults) {
    results[index] = embedding;
  }
  const toWrite = [];
  if (cacheResults.length < texts.length) {
    const missingIndexes = [...results.keys()].filter((i) => !results[i]);
    const missingTexts = missingIndexes.map((i) => texts[i]);
    const response = await fetchEmbeddingBatch(missingTexts);
    if (response.embeddings.length !== missingIndexes.length) {
      throw new Error(
        `Expected ${missingIndexes.length} embeddings, got ${response.embeddings.length}`,
      );
    }
    for (let i = 0; i < missingIndexes.length; i++) {
      const resultIndex = missingIndexes[i];
      toWrite.push({
        textHash: textHashes[resultIndex],
        embedding: response.embeddings[i],
      });
      results[resultIndex] = response.embeddings[i];
    }
  }
  if (toWrite.length > 0) {
    await ctx.runMutation(selfInternal.writeEmbeddings, { embeddings: toWrite });
  }
  return {
    embeddings: results,
    hits: cacheResults.length,
    ms: Date.now() - start,
  };
  } catch (error) {
    console.error("Error in fetchBatch:", error);
    throw new Error("An internal error occurred while fetching embeddings.");
  }
}

async function hashText(text: string) {
  const textEncoder = new TextEncoder();
  const buf = textEncoder.encode(text);
  if (typeof crypto === 'undefined') {
    // Ugly, ugly hax to get ESBuild to not try to bundle this node dependency.
    const f = () => 'node:crypto';
    // @ts-ignore
    const crypto = (await import(f())) as typeof import('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(buf);
    return hash.digest().buffer;
  } else {
    return await crypto.subtle.digest('SHA-256', buf);
  }
}

export async function getEmbeddingsByTextHandler(ctx: QueryCtx, args: { textHashes: ArrayBuffer[] }) {
  try {
    const out = [];
    for (let i = 0; i < args.textHashes.length; i++) {
      const textHash = args.textHashes[i];
      const result = await ctx.db
        .query('embeddingsCache')
        .withIndex('text', (q: any) => q.eq('textHash', textHash))
        .first();
      if (result) {
        out.push({
          index: i,
          embeddingId: result._id,
          embedding: result.embedding,
        });
      }
    }
    return out;
  } catch (error) {
    console.error("Error in getEmbeddingsByText:", error);
    throw new Error("An internal error occurred retrieving embeddings.");
  }
}

export const getEmbeddingsByText = internalQuery({
  args: { textHashes: v.array(v.bytes()) },
  handler: getEmbeddingsByTextHandler,
});

export async function writeEmbeddingsHandler(ctx: MutationCtx, args: { embeddings: Array<{ textHash: ArrayBuffer; embedding: number[] }> }) {
  try {
    const ids = [];
    for (const embedding of args.embeddings) {
      ids.push(await ctx.db.insert('embeddingsCache', embedding));
    }
    return ids;
  } catch (error) {
    console.error("Error in writeEmbeddings:", error);
    throw new Error("An internal error occurred writing embeddings.");
  }
}

export const writeEmbeddings = internalMutation({
  args: {
    embeddings: v.array(
      v.object({
        textHash: v.bytes(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: writeEmbeddingsHandler,
});
