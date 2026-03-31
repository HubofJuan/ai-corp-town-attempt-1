import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { queryPromptDataHandler, startConversationMessage } from '../convex/agent/conversation';
import { fetchBatch } from '../convex/agent/embeddingsCache';

describe('Robust Error Handling in Convex AI Handlers', () => {
  let mockCtx: any;

  beforeEach(() => {
    // Mock the ActionCtx and QueryCtx
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
        insert: jest.fn()
      }
    };

    // Override console.error to keep test output clean, but spy on it to verify logging
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('conversation.ts', () => {
    it('queryPromptData should throw generic error if internal exception occurs', async () => {
      // Simulate an internal failure (e.g. database error)
      mockCtx.db.get.mockRejectedValue(new Error('Internal Database Timeout ID:123'));

      await expect(
        queryPromptDataHandler(mockCtx, {
          worldId: 'world_123',
          playerId: 'player1',
          otherPlayerId: 'player2',
          conversationId: 'conv_123'
        })
      ).rejects.toThrow('An internal error occurred fetching prompt data.');

      expect(console.error).toHaveBeenCalledWith(
        'Error in queryPromptData:',
        expect.any(Error)
      );
    });

    it('startConversationMessage should catch error and throw generic error', async () => {
      mockCtx.runQuery.mockRejectedValue(new Error('Missing Identity 404'));

      await expect(
        startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p_1' as any, 'p_2' as any)
      ).rejects.toThrow('An internal error occurred while generating a conversation message.');

      expect(console.error).toHaveBeenCalledWith(
        'Error in startConversationMessage:',
        expect.any(Error)
      );
    });
  });

  describe('embeddingsCache.ts', () => {
    it('fetchBatch should catch and throw generic errors', async () => {
      // Force query to fail
      mockCtx.runQuery.mockRejectedValue(new Error('Cache missing DB down'));

      await expect(
        fetchBatch(mockCtx, ['Hello World'])
      ).rejects.toThrow('An internal error occurred while fetching embeddings.');

      expect(console.error).toHaveBeenCalledWith(
        'Error in fetchBatch:',
        expect.any(Error)
      );
    });
  });
});
