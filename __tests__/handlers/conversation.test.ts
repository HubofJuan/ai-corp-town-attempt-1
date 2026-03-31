import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  continueConversationMessage,
  leaveConversationMessage,
} from '../../convex/agent/conversation';

describe('Conversation Handlers', () => {
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
        order: jest.fn().mockReturnThis(),
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

  describe('continueConversationMessage', () => {
    it('should throw a generic error when runQuery fails', async () => {
      mockCtx.runQuery.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        continueConversationMessage(
          mockCtx,
          'world_1' as any,
          'conv_1' as any,
          'player_1' as any,
          'player_2' as any,
        ),
      ).rejects.toThrow('An internal error occurred while continuing a conversation message.');

      expect(console.error).toHaveBeenCalledWith(
        'Error in continueConversationMessage:',
        expect.any(Error),
      );
    });

    it('should not leak internal error details in the thrown message', async () => {
      const internalMsg = 'SECRET_TOKEN_xyz: DB timeout at host 10.0.0.1:5432';
      mockCtx.runQuery.mockRejectedValue(new Error(internalMsg));

      let thrownMessage = '';
      try {
        await continueConversationMessage(
          mockCtx,
          'world_1' as any,
          'conv_1' as any,
          'player_1' as any,
          'player_2' as any,
        );
      } catch (e: any) {
        thrownMessage = e.message;
      }

      expect(thrownMessage).not.toContain('SECRET_TOKEN');
      expect(thrownMessage).not.toContain('10.0.0.1');
      expect(thrownMessage).toBe(
        'An internal error occurred while continuing a conversation message.',
      );
    });
  });

  describe('leaveConversationMessage', () => {
    it('should throw a generic error when runQuery fails', async () => {
      mockCtx.runQuery.mockRejectedValue(new Error('World not found'));

      await expect(
        leaveConversationMessage(
          mockCtx,
          'world_1' as any,
          'conv_1' as any,
          'player_1' as any,
          'player_2' as any,
        ),
      ).rejects.toThrow('An internal error occurred while generating a leave message.');

      expect(console.error).toHaveBeenCalledWith(
        'Error in leaveConversationMessage:',
        expect.any(Error),
      );
    });

    it('should not expose internal error details in the thrown message', async () => {
      const internalMsg = 'Player ID auth_token_9876 failed validation';
      mockCtx.runQuery.mockRejectedValue(new Error(internalMsg));

      let thrownMessage = '';
      try {
        await leaveConversationMessage(
          mockCtx,
          'world_1' as any,
          'conv_1' as any,
          'player_1' as any,
          'player_2' as any,
        );
      } catch (e: any) {
        thrownMessage = e.message;
      }

      expect(thrownMessage).not.toContain('auth_token_9876');
      expect(thrownMessage).toBe(
        'An internal error occurred while generating a leave message.',
      );
    });
  });
});
