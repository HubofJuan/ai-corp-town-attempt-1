import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock LLM and other agent modules so conversation.ts can load without them
jest.unstable_mockModule('../../convex/util/llm', () => ({
  chatCompletion: jest.fn(),
  LLMMessage: {},
  EMBEDDING_DIMENSION: 1024,
  fetchEmbedding: jest.fn(),
  fetchEmbeddingBatch: jest.fn(),
  getLLMConfig: jest.fn(),
  retryWithBackoff: jest.fn(),
  ChatCompletionContent: class {},
}));

jest.unstable_mockModule('../../convex/agent/embeddingsCache', () => ({
  fetch: jest.fn(),
  fetchBatch: jest.fn(),
  getEmbeddingsByText: {},
  writeEmbeddings: {},
}));

jest.unstable_mockModule('../../convex/agent/memory', () => ({
  searchMemories: jest.fn(),
  Memory: {},
  rememberConversation: jest.fn(),
  MEMORY_ACCESS_THROTTLE: 300_000,
  rankAndTouchMemories: {},
}));

const {
  stopWords,
  trimContentPrefix,
  agentPrompts,
  previousConversationPrompt,
  relatedMemoriesPrompt,
} = await import('../../convex/agent/conversation');

describe('Prompt Helper Functions', () => {
  // ─── stopWords ──────────────────────────────────────────────
  describe('stopWords', () => {
    it('should return both original-case and lowercase variants', () => {
      const result = stopWords('Bob', 'Alice');
      expect(result).toContain('Bob to Alice:');
      expect(result).toContain('bob to alice:');
    });

    it('should handle single-word names', () => {
      const result = stopWords('Kira', 'Alex');
      expect(result).toHaveLength(2);
      expect(result).toContain('Kira to Alex:');
      expect(result).toContain('kira to alex:');
    });

    it('should handle multi-word names', () => {
      const result = stopWords('Dr. Bob Smith', 'Alice Johnson');
      expect(result).toContain('Dr. Bob Smith to Alice Johnson:');
      expect(result).toContain('dr. bob smith to alice johnson:');
    });
  });

  // ─── trimContentPrefix ─────────────────────────────────────
  describe('trimContentPrefix', () => {
    it('should remove matching prefix and trim whitespace', () => {
      const result = trimContentPrefix('Alice to Bob: Hello there!', 'Alice to Bob:');
      expect(result).toBe('Hello there!');
    });

    it('should return content unchanged when prefix does not match', () => {
      const result = trimContentPrefix('Hello there!', 'Alice to Bob:');
      expect(result).toBe('Hello there!');
    });

    it('should handle content that equals the prefix exactly', () => {
      const result = trimContentPrefix('Alice to Bob:', 'Alice to Bob:');
      expect(result).toBe('');
    });

    it('should trim leading whitespace after prefix removal', () => {
      const result = trimContentPrefix('Alice to Bob:   Howdy!', 'Alice to Bob:');
      expect(result).toBe('Howdy!');
    });
  });

  // ─── agentPrompts ──────────────────────────────────────────
  describe('agentPrompts', () => {
    it('should include identity and plan when agent is provided', () => {
      const result = agentPrompts(
        { name: 'Bob' },
        { identity: 'A friendly farmer', plan: 'Sell vegetables' },
        null,
      );
      expect(result).toEqual(
        expect.arrayContaining([
          expect.stringContaining('A friendly farmer'),
          expect.stringContaining('Sell vegetables'),
        ]),
      );
    });

    it('should include other agent identity when otherAgent is provided', () => {
      const result = agentPrompts(
        { name: 'Bob' },
        { identity: 'A friendly farmer', plan: 'Sell vegetables' },
        { identity: 'A curious scientist', plan: 'Research flora' },
      );
      expect(result.some((s: string) => s.includes('A curious scientist'))).toBe(true);
      expect(result.some((s: string) => s.includes('Bob'))).toBe(true);
    });

    it('should return empty array when both agents are null', () => {
      const result = agentPrompts({ name: 'Bob' }, null, null);
      expect(result).toEqual([]);
    });

    it('should handle agent present but otherAgent null', () => {
      const result = agentPrompts(
        { name: 'Bob' },
        { identity: 'Kind baker', plan: 'Bake bread' },
        null,
      );
      expect(result.length).toBe(2);
      expect(result.some((s: string) => s.includes('Kind baker'))).toBe(true);
      expect(result.some((s: string) => s.includes('Bob'))).toBe(false);
    });
  });

  // ─── previousConversationPrompt ────────────────────────────
  describe('previousConversationPrompt', () => {
    it('should format date when conversation exists', () => {
      const created = new Date('2024-06-15T10:30:00Z').getTime();
      const result = previousConversationPrompt({ name: 'Bob' }, { created });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('Bob');
      expect(result[0]).toContain('Last time you chatted with');
    });

    it('should return empty array when conversation is null', () => {
      const result = previousConversationPrompt({ name: 'Bob' }, null);
      expect(result).toEqual([]);
    });
  });

  // ─── relatedMemoriesPrompt ─────────────────────────────────
  describe('relatedMemoriesPrompt', () => {
    it('should list each memory description with " - " prefix', () => {
      const memories = [
        { description: 'Talked about the weather' },
        { description: 'Shared a meal together' },
      ];
      const result = relatedMemoriesPrompt(memories as any);
      expect(result).toContain(' - Talked about the weather');
      expect(result).toContain(' - Shared a meal together');
    });

    it('should include relevance header when memories exist', () => {
      const memories = [{ description: 'Some memory' }];
      const result = relatedMemoriesPrompt(memories as any);
      expect(result[0]).toContain('related memories');
    });

    it('should return empty array for empty memories list', () => {
      const result = relatedMemoriesPrompt([]);
      expect(result).toEqual([]);
    });
  });
});
