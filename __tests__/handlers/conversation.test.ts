import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ─── ESM module mocks (must be registered BEFORE dynamic imports) ────────
const mockChatCompletion = jest.fn();
const mockEmbeddingsCacheFetch = jest.fn();
const mockSearchMemories = jest.fn();

jest.unstable_mockModule('../../convex/util/llm', () => ({
  chatCompletion: mockChatCompletion,
  LLMMessage: {},
  EMBEDDING_DIMENSION: 1024,
  fetchEmbedding: jest.fn(),
  fetchEmbeddingBatch: jest.fn(),
  getLLMConfig: jest.fn(),
  retryWithBackoff: jest.fn(),
  ChatCompletionContent: class {},
}));

jest.unstable_mockModule('../../convex/agent/embeddingsCache', () => ({
  fetch: mockEmbeddingsCacheFetch,
  fetchBatch: jest.fn(),
  getEmbeddingsByText: {},
  writeEmbeddings: {},
}));

jest.unstable_mockModule('../../convex/agent/memory', () => ({
  searchMemories: mockSearchMemories,
  Memory: {},
  rememberConversation: jest.fn(),
  MEMORY_ACCESS_THROTTLE: 300_000,
  rankAndTouchMemories: {},
}));

// Dynamic import AFTER mock registration
const {
  startConversationMessage,
  continueConversationMessage,
  leaveConversationMessage,
} = await import('../../convex/agent/conversation');

// ─── Shared fixtures ────────────────────────────────────────────────────
const MOCK_EMBEDDING = Array(1024).fill(0.1);

function makePromptData(overrides: Record<string, any> = {}) {
  return {
    player: { id: 'p:player1', name: 'Alice' },
    otherPlayer: { id: 'p:player2', name: 'Bob' },
    conversation: { id: 'c:conv1', created: Date.now() - 60_000 },
    agent: { identity: 'A friendly neighbor who loves gardening', plan: 'Make friends and share gardening tips' },
    otherAgent: { identity: 'A curious scientist studying plants', plan: 'Learn about local flora' },
    lastConversation: null,
    ...overrides,
  };
}

function makeMockCtx() {
  return {
    runQuery: jest.fn(),
    runMutation: jest.fn(),
    vectorSearch: jest.fn(),
    scheduler: { runAfter: jest.fn() },
    storage: {},
    auth: {},
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────
describe('Conversation Handlers', () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = makeMockCtx();
    mockChatCompletion.mockReset();
    mockEmbeddingsCacheFetch.mockReset();
    mockSearchMemories.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // Error-masking tests (preserved from original)
  // ═══════════════════════════════════════════════════════════════
  describe('continueConversationMessage - error masking', () => {
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

  describe('leaveConversationMessage - error masking', () => {
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

  // ═══════════════════════════════════════════════════════════════
  // Happy-path tests: startConversationMessage
  // ═══════════════════════════════════════════════════════════════
  describe('startConversationMessage - happy path', () => {
    beforeEach(() => {
      const promptData = makePromptData();
      mockCtx.runQuery.mockResolvedValue(promptData);
      mockEmbeddingsCacheFetch.mockResolvedValue(MOCK_EMBEDDING);
      mockSearchMemories.mockResolvedValue([]);
      mockChatCompletion.mockResolvedValue({ content: 'Hi Bob, lovely weather today!', retries: 0, ms: 100 });
    });

    it('should call runQuery to fetch prompt data with correct args', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        expect.anything(), // internal query reference
        expect.objectContaining({
          worldId: 'world_1',
          playerId: 'p:player1',
          otherPlayerId: 'p:player2',
          conversationId: 'conv_1',
        }),
      );
    });

    it('should fetch embedding for "{player} is talking to {otherPlayer}"', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(mockEmbeddingsCacheFetch).toHaveBeenCalledWith(mockCtx, 'Alice is talking to Bob');
    });

    it('should call searchMemories with player ID and embedding', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(mockSearchMemories).toHaveBeenCalledWith(
        mockCtx,
        'p:player1',
        MOCK_EMBEDDING,
        expect.any(Number),
      );
    });

    it('should call chatCompletion with system prompt containing player names', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
      const callArgs = mockChatCompletion.mock.calls[0][0];
      const systemMsg = callArgs.messages[0];
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.content).toContain('You are Alice');
      expect(systemMsg.content).toContain('Bob');
    });

    it('should include agent identity and plan in the system prompt', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('A friendly neighbor who loves gardening');
      expect(systemContent).toContain('Make friends and share gardening tips');
    });

    it('should include other agent identity in the system prompt', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('A curious scientist studying plants');
    });

    it('should include previous conversation date when lastConversation is not null', async () => {
      const pastDate = Date.now() - 3_600_000;
      mockCtx.runQuery.mockResolvedValue(makePromptData({ lastConversation: { created: pastDate } }));

      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('Last time you chatted with Bob');
    });

    it('should include related memories in prompt when memories exist', async () => {
      mockSearchMemories.mockResolvedValue([
        { description: 'Talked about the weather and roses', data: { type: 'reflection' } },
        { description: 'Shared lunch together', data: { type: 'reflection' } },
      ]);

      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('Talked about the weather and roses');
      expect(systemContent).toContain('Shared lunch together');
    });

    it('should mention previous conversation when memory with other player exists', async () => {
      mockSearchMemories.mockResolvedValue([
        {
          description: 'Had a nice chat with Bob about science',
          data: { type: 'conversation', playerIds: ['p:player2'] },
        },
      ]);

      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('previous conversation');
    });

    it('should pass correct stop words to chatCompletion', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const callArgs = mockChatCompletion.mock.calls[0][0];
      expect(callArgs.stop).toContain('Bob to Alice:');
      expect(callArgs.stop).toContain('bob to alice:');
    });

    it('should trim the "{player} to {otherPlayer}:" prefix from LLM response', async () => {
      mockChatCompletion.mockResolvedValue({ content: 'Alice to Bob: Hello there!', retries: 0, ms: 50 });

      const result = await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(result).toBe('Hello there!');
    });

    it('should return content directly when it does not start with prefix', async () => {
      mockChatCompletion.mockResolvedValue({ content: 'Hey, nice to meet you!', retries: 0, ms: 50 });

      const result = await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(result).toBe('Hey, nice to meet you!');
    });

    it('should set max_tokens to 300', async () => {
      await startConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(mockChatCompletion.mock.calls[0][0].max_tokens).toBe(300);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Happy-path tests: continueConversationMessage
  // ═══════════════════════════════════════════════════════════════
  describe('continueConversationMessage - happy path', () => {
    const previousChatMessages = [
      { author: 'p:player1', text: 'Hi there Bob!' },
      { author: 'p:player2', text: 'Hello Alice, how are you?' },
    ];

    beforeEach(() => {
      const promptData = makePromptData();
      // First runQuery: queryPromptData; Second runQuery: listMessages
      mockCtx.runQuery
        .mockResolvedValueOnce(promptData)
        .mockResolvedValueOnce(previousChatMessages);
      mockEmbeddingsCacheFetch.mockResolvedValue(MOCK_EMBEDDING);
      mockSearchMemories.mockResolvedValue([]);
      mockChatCompletion.mockResolvedValue({ content: "That's great to hear!", retries: 0, ms: 80 });
    });

    it('should fetch embedding for "What do you think about {otherPlayer}?"', async () => {
      await continueConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(mockEmbeddingsCacheFetch).toHaveBeenCalledWith(
        mockCtx,
        'What do you think about Bob?',
      );
    });

    it('should include conversation start time in system prompt', async () => {
      await continueConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('The conversation started at');
    });

    it('should pass previous messages as user-role LLM messages', async () => {
      await continueConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const messages = mockChatCompletion.mock.calls[0][0].messages;
      // messages[0] = system prompt
      // messages[1..n-1] = previous chat messages
      // messages[n] = final turn prompt
      const chatMessages = messages.slice(1, -1);
      expect(chatMessages).toHaveLength(2);
      expect(chatMessages[0].content).toContain('Alice to Bob: Hi there Bob!');
      expect(chatMessages[1].content).toContain('Bob to Alice: Hello Alice, how are you?');
    });

    it('should append "{player} to {otherPlayer}:" as final user message', async () => {
      await continueConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const messages = mockChatCompletion.mock.calls[0][0].messages;
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content).toBe('Alice to Bob:');
    });

    it('should include instruction to not greet again', async () => {
      await continueConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('DO NOT greet them again');
    });

    it('should return trimmed content', async () => {
      mockChatCompletion.mockResolvedValue({ content: 'Alice to Bob: Sure thing!', retries: 0, ms: 50 });

      const result = await continueConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(result).toBe('Sure thing!');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Happy-path tests: leaveConversationMessage
  // ═══════════════════════════════════════════════════════════════
  describe('leaveConversationMessage - happy path', () => {
    const previousChatMessages = [
      { author: 'p:player1', text: 'This has been nice' },
      { author: 'p:player2', text: 'Indeed it has!' },
    ];

    beforeEach(() => {
      const promptData = makePromptData();
      mockCtx.runQuery
        .mockResolvedValueOnce(promptData)
        .mockResolvedValueOnce(previousChatMessages);
      mockChatCompletion.mockResolvedValue({ content: 'Well, I should get going. See you later!', retries: 0, ms: 60 });
    });

    it('should build prompt mentioning intent to leave', async () => {
      await leaveConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('leaving');
    });

    it('should include previous messages in the LLM call', async () => {
      await leaveConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const messages = mockChatCompletion.mock.calls[0][0].messages;
      const chatMessages = messages.slice(1, -1);
      expect(chatMessages.length).toBeGreaterThan(0);
      expect(chatMessages[0].content).toContain('This has been nice');
    });

    it('should return trimmed content from LLM response', async () => {
      const result = await leaveConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      expect(result).toBe('Well, I should get going. See you later!');
    });

    it('should include instruction about response length', async () => {
      await leaveConversationMessage(mockCtx, 'world_1' as any, 'conv_1' as any, 'p:player1' as any, 'p:player2' as any);

      const systemContent = mockChatCompletion.mock.calls[0][0].messages[0].content;
      expect(systemContent).toContain('200 characters');
    });
  });
});
