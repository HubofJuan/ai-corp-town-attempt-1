import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  getLLMConfig,
  EMBEDDING_DIMENSION,
  retryWithBackoff,
  chatCompletion,
  fetchEmbeddingBatch,
  tryPullOllama,
} from '../../convex/util/llm';

describe('LLM Utilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all LLM-related env vars to get clean Ollama defaults
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_CHAT_MODEL;
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.TOGETHER_CHAT_MODEL;
    delete process.env.TOGETHER_EMBEDDING_MODEL;
    delete process.env.LLM_API_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_EMBEDDING_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_EMBEDDING_MODEL;

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  // ─── Canary test ───────────────────────────────────────────────
  describe('EMBEDDING_DIMENSION', () => {
    it('should be 1024 (Ollama default)', () => {
      expect(EMBEDDING_DIMENSION).toBe(1024);
    });
  });

  // ─── getLLMConfig ──────────────────────────────────────────────
  describe('getLLMConfig', () => {
    describe('Ollama provider (default)', () => {
      it('should return correct Ollama defaults when no env vars are set', () => {
        const config = getLLMConfig();
        expect(config.provider).toBe('ollama');
        expect(config.url).toBe('http://127.0.0.1:11434');
        expect(config.chatModel).toBe('llama3');
        expect(config.embeddingModel).toBe('mxbai-embed-large');
        expect(config.stopWords).toContain('<|eot_id|>');
        expect(config.apiKey).toBeUndefined();
      });

      it('should use OLLAMA_HOST env var when set', () => {
        process.env.OLLAMA_HOST = 'http://remote-ollama:11434';
        const config = getLLMConfig();
        expect(config.url).toBe('http://remote-ollama:11434');
      });

      it('should use OLLAMA_MODEL env var when set', () => {
        process.env.OLLAMA_MODEL = 'mistral';
        const config = getLLMConfig();
        expect(config.chatModel).toBe('mistral');
      });

      it('should use OLLAMA_EMBEDDING_MODEL env var when set', () => {
        process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
        const config = getLLMConfig();
        expect(config.embeddingModel).toBe('nomic-embed-text');
      });
    });

    describe('OpenAI provider', () => {
      it('should throw EMBEDDING_DIMENSION mismatch when OPENAI_API_KEY is set', () => {
        process.env.OPENAI_API_KEY = 'sk-test-key';
        expect(() => getLLMConfig()).toThrow('EMBEDDING_DIMENSION must be 1536 for OpenAI');
      });

      it('should throw when LLM_PROVIDER=openai even without API key', () => {
        process.env.LLM_PROVIDER = 'openai';
        expect(() => getLLMConfig()).toThrow('EMBEDDING_DIMENSION must be 1536 for OpenAI');
      });
    });

    describe('Together provider', () => {
      it('should throw EMBEDDING_DIMENSION mismatch when TOGETHER_API_KEY is set', () => {
        process.env.TOGETHER_API_KEY = 'tog-test-key';
        expect(() => getLLMConfig()).toThrow('EMBEDDING_DIMENSION must be 768 for Together.ai');
      });
    });

    describe('Custom provider', () => {
      it('should return custom config when all required vars are set', () => {
        process.env.LLM_API_URL = 'https://my-llm.example.com';
        process.env.LLM_MODEL = 'my-model';
        process.env.LLM_EMBEDDING_MODEL = 'my-embed-model';
        process.env.LLM_API_KEY = 'custom-key';

        const config = getLLMConfig();
        expect(config.provider).toBe('custom');
        expect(config.url).toBe('https://my-llm.example.com');
        expect(config.chatModel).toBe('my-model');
        expect(config.embeddingModel).toBe('my-embed-model');
        expect(config.apiKey).toBe('custom-key');
      });

      it('should throw when LLM_MODEL is missing', () => {
        process.env.LLM_API_URL = 'https://my-llm.example.com';
        process.env.LLM_EMBEDDING_MODEL = 'my-embed-model';
        expect(() => getLLMConfig()).toThrow('LLM_MODEL is required');
      });

      it('should throw when LLM_EMBEDDING_MODEL is missing', () => {
        process.env.LLM_API_URL = 'https://my-llm.example.com';
        process.env.LLM_MODEL = 'my-model';
        expect(() => getLLMConfig()).toThrow('LLM_EMBEDDING_MODEL is required');
      });
    });
  });

  // ─── retryWithBackoff ─────────────────────────────────────────
  describe('retryWithBackoff', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return result on first success with retries=0', async () => {
      const fn = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      const promise = retryWithBackoff(fn);
      const result = await promise;

      expect(result.result).toBe('success');
      expect(result.retries).toBe(0);
      expect(typeof result.ms).toBe('number');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and succeed on second attempt', async () => {
      const fn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce({ retry: true, error: new Error('429 rate limited') })
        .mockResolvedValueOnce('recovered');

      const promise = retryWithBackoff(fn);

      // Advance past the first retry delay (1000ms + up to 100ms jitter)
      await jest.advanceTimersByTimeAsync(1200);

      const result = await promise;
      expect(result.result).toBe('recovered');
      expect(result.retries).toBe(1);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on non-retryable error', async () => {
      const error = new Error('400 bad request');
      const fn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce({ retry: false, error });

      await expect(retryWithBackoff(fn)).rejects.toThrow('400 bad request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting all retries (4 total attempts)', async () => {
      jest.useRealTimers();

      const error = new Error('500 server error');
      let callCount = 0;
      const fn = jest.fn<() => Promise<string>>().mockImplementation(async () => {
        callCount++;
        throw { retry: true, error };
      });

      // Use real timers but patch RETRY_BACKOFF is [1000, 10000, 20000]
      // To avoid 31s wait, we test with real timers but accept the timing
      // Actually, let's use a simpler approach: just verify the error and call count
      await expect(retryWithBackoff(fn)).rejects.toThrow('500 server error');
      expect(fn).toHaveBeenCalledTimes(4);
    }, 60_000);

    it('should throw the raw error if it lacks the RetryError shape', async () => {
      const rawError = new Error('unexpected crash');
      const fn = jest.fn<() => Promise<string>>().mockRejectedValue(rawError);

      await expect(retryWithBackoff(fn)).rejects.toBe(rawError);
    });
  });

  // ─── chatCompletion ───────────────────────────────────────────
  describe('chatCompletion', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as jest.Mock<typeof fetch>;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    function mockFetchResponse(body: object, status = 200) {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response);
    }

    function mockFetchSequence(responses: Array<{ body: object | string; status: number }>) {
      const mock = global.fetch as jest.Mock<typeof fetch>;
      for (const resp of responses) {
        mock.mockResolvedValueOnce({
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => (typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body),
          text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
        } as Response);
      }
    }

    const validResponse = {
      choices: [{ message: { content: 'Hello there!' } }],
    };

    it('should POST to {url}/v1/chat/completions', async () => {
      mockFetchResponse(validResponse);

      await chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should return content from successful non-streaming response', async () => {
      mockFetchResponse(validResponse);

      const result = await chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toBe('Hello there!');
      expect(typeof result.retries).toBe('number');
      expect(typeof result.ms).toBe('number');
    });

    it('should set model from config when not provided in body', async () => {
      mockFetchResponse(validResponse);

      await chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const callArgs = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.model).toBe('llama3');
    });

    it('should NOT include Authorization header for Ollama (no apiKey)', async () => {
      mockFetchResponse(validResponse);

      await chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const callArgs = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const headers = callArgs[1]!.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('should throw on non-ok 400 response without retrying', async () => {
      mockFetchResponse({ error: 'Bad request' }, 400);

      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(/Chat completion failed with code 400/);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 then succeed', async () => {
      jest.useFakeTimers();

      mockFetchSequence([
        { body: { error: 'rate limited' }, status: 429 },
        { body: validResponse, status: 200 },
      ]);

      const promise = chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      await jest.advanceTimersByTimeAsync(1200);
      const result = await promise;

      expect(result.content).toBe('Hello there!');
      expect(result.retries).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should retry on 500 then succeed', async () => {
      jest.useFakeTimers();

      mockFetchSequence([
        { body: { error: 'internal error' }, status: 500 },
        { body: validResponse, status: 200 },
      ]);

      const promise = chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      await jest.advanceTimersByTimeAsync(1200);
      const result = await promise;

      expect(result.content).toBe('Hello there!');
      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should throw when response JSON has undefined content', async () => {
      mockFetchResponse({
        choices: [{ message: {} }],
      });

      await expect(
        chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow('Unexpected result from OpenAI');
    });

    it('should attempt Ollama model pull on 404 with "try pulling" in error text', async () => {
      jest.useFakeTimers();

      mockFetchSequence([
        { body: 'model not found, try pulling it first', status: 404 },
        { body: 'pulling model...done', status: 200 }, // pull response
        { body: 'model not found, try pulling it first', status: 404 }, // retry triggers pull again
        { body: 'pulling model...done', status: 200 }, // second pull
        { body: validResponse, status: 200 }, // finally succeeds
      ]);

      const promise = chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      // Advance through retry delays
      await jest.advanceTimersByTimeAsync(35_000);

      const result = await promise;
      expect(result.content).toBe('Hello there!');

      // Verify /api/pull was called
      const fetchCalls = (global.fetch as jest.Mock<typeof fetch>).mock.calls;
      const pullCalls = fetchCalls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/pull'),
      );
      expect(pullCalls.length).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });

  // ─── fetchEmbeddingBatch ──────────────────────────────────────
  describe('fetchEmbeddingBatch', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as jest.Mock<typeof fetch>;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should use Ollama /api/embeddings endpoint', async () => {
      const mockEmbedding = Array(1024).fill(0.1);
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embedding: mockEmbedding }),
      } as Response);

      const result = await fetchEmbeddingBatch(['test text']);

      expect(result.ollama).toBe(true);

      const fetchCalls = (global.fetch as jest.Mock<typeof fetch>).mock.calls;
      expect(fetchCalls[0][0]).toContain('/api/embeddings');
      expect(fetchCalls[0][0]).not.toContain('/v1/embeddings');
    });

    it('should return one embedding per input text', async () => {
      const mockEmbedding = Array(1024).fill(0.1);
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embedding: mockEmbedding }),
      } as Response);

      const result = await fetchEmbeddingBatch(['text1', 'text2']);

      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toEqual(mockEmbedding);
      expect(result.embeddings[1]).toEqual(mockEmbedding);
    });

    it('should handle empty input array without calling fetch', async () => {
      const result = await fetchEmbeddingBatch([]);

      expect(result.embeddings).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should throw on network failure (Ollama unreachable)', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockRejectedValue(
        new Error('fetch failed: Connection refused'),
      );

      await expect(fetchEmbeddingBatch(['fail text'])).rejects.toThrow(
        'fetch failed: Connection refused',
      );
    });
  });

  // ─── tryPullOllama ────────────────────────────────────────────
  describe('tryPullOllama', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as jest.Mock<typeof fetch>;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should call /api/pull when error contains "try pulling"', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        text: async () => 'done',
      } as Response);

      // tryPullOllama throws { retry: true, error: string } (not an Error instance)
      await expect(
        tryPullOllama('llama3', 'model not found, try pulling it first'),
      ).rejects.toMatchObject({
        retry: true,
        error: expect.stringContaining('Dynamically pulled model'),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/pull'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'llama3' }),
        }),
      );
    });

    it('should do nothing when error does not contain "try pulling"', async () => {
      // Should not throw, should not call fetch
      await tryPullOllama('llama3', 'some other error');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
