import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { fetchBatch, getEmbeddingsByTextHandler, writeEmbeddingsHandler } from '../../convex/agent/embeddingsCache';

describe('EmbeddingsCache Handlers', () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      runQuery: jest.fn(),
      runMutation: jest.fn(),
      db: {
        get: jest.fn(),
        query: jest.fn().mockReturnThis(),
        withIndex: jest.fn().mockReturnThis(),
        filter: jest.fn().mockReturnThis(),
        first: jest.fn(),
        collect: jest.fn(),
        insert: jest.fn(),
      },
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchBatch', () => {
    it('should throw a generic error when runQuery fails', async () => {
      mockCtx.runQuery.mockRejectedValue(new Error('Cache DB down'));

      await expect(fetchBatch(mockCtx, ['hello'])).rejects.toThrow(
        'An internal error occurred while fetching embeddings.',
      );

      expect(console.error).toHaveBeenCalledWith(
        'Error in fetchBatch:',
        expect.any(Error),
      );
    });

    it('should not leak internal details in the thrown error', async () => {
      mockCtx.runQuery.mockRejectedValue(new Error('private-key-abc123 failed'));

      let msg = '';
      try {
        await fetchBatch(mockCtx, ['test']);
      } catch (e: any) {
        msg = e.message;
      }

      expect(msg).not.toContain('private-key');
      expect(msg).toBe('An internal error occurred while fetching embeddings.');
    });

    it('should handle an empty texts array without throwing', async () => {
      // runQuery returns empty cache result → no embeddings needed → no mutation called
      mockCtx.runQuery.mockResolvedValue([]);

      const result = await fetchBatch(mockCtx, []);

      expect(result.embeddings).toEqual([]);
      expect(result.hits).toBe(0);
      expect(typeof result.ms).toBe('number');
      expect(mockCtx.runMutation).not.toHaveBeenCalled();
    });
  });

  describe('getEmbeddingsByText (internalQuery handler)', () => {
    it('should return matching embeddings for cached text hashes', async () => {
      const fakeEmbedding = [0.1, 0.2, 0.3];
      const fakeId = 'emb_1';
      const textHash = new Uint8Array(32).buffer;

      mockCtx.db.first.mockResolvedValue({
        _id: fakeId,
        textHash,
        embedding: fakeEmbedding,
      });

      const result = await getEmbeddingsByTextHandler(mockCtx, { textHashes: [textHash] });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        index: 0,
        embeddingId: fakeId,
        embedding: fakeEmbedding,
      });
    });

    it('should return empty array when no cached embeddings exist', async () => {
      mockCtx.db.first.mockResolvedValue(null);

      const textHash = new Uint8Array(32).buffer;
      const result = await getEmbeddingsByTextHandler(mockCtx, { textHashes: [textHash] });

      expect(result).toEqual([]);
    });

    it('should throw a generic error when db.query fails', async () => {
      mockCtx.db.first.mockRejectedValue(new Error('Index corrupted ID:999'));

      const textHash = new Uint8Array(32).buffer;

      await expect(getEmbeddingsByTextHandler(mockCtx, { textHashes: [textHash] })).rejects.toThrow(
        'An internal error occurred retrieving embeddings.',
      );

      expect(console.error).toHaveBeenCalledWith(
        'Error in getEmbeddingsByText:',
        expect.any(Error),
      );
    });
  });

  describe('writeEmbeddings (internalMutation handler)', () => {
    it('should insert embeddings and return their IDs', async () => {
      mockCtx.db.insert.mockResolvedValueOnce('id_1').mockResolvedValueOnce('id_2');

      const textHash = new Uint8Array(32).buffer;

      const result = await writeEmbeddingsHandler(mockCtx, {
        embeddings: [
          { textHash, embedding: [0.1, 0.2] },
          { textHash, embedding: [0.3, 0.4] },
        ],
      });

      expect(result).toEqual(['id_1', 'id_2']);
      expect(mockCtx.db.insert).toHaveBeenCalledTimes(2);
      expect(mockCtx.db.insert).toHaveBeenCalledWith('embeddingsCache', expect.objectContaining({
        embedding: [0.1, 0.2],
      }));
    });

    it('should return an empty array when given no embeddings', async () => {
      const result = await writeEmbeddingsHandler(mockCtx, { embeddings: [] });

      expect(result).toEqual([]);
      expect(mockCtx.db.insert).not.toHaveBeenCalled();
    });

    it('should throw a generic error when db.insert fails', async () => {
      mockCtx.db.insert.mockRejectedValue(new Error('Disk quota exceeded'));

      const textHash = new Uint8Array(32).buffer;

      await expect(
        writeEmbeddingsHandler(mockCtx, { embeddings: [{ textHash, embedding: [0.1] }] }),
      ).rejects.toThrow('An internal error occurred writing embeddings.');

      expect(console.error).toHaveBeenCalledWith(
        'Error in writeEmbeddings:',
        expect.any(Error),
      );
    });
  });
});
