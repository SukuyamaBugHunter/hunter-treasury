import { randomUUID } from 'node:crypto';

import { INTERCOMSWAP_SYSTEM_PROMPT } from './system.js';
import { INTERCOMSWAP_TOOLS } from './tools.js';
import { OpenAICompatibleClient } from './openaiClient.js';
import { loadLlmConfigFromEnv } from './config.js';
import { AuditLog } from './audit.js';

function nowMs() {
  return Date.now();
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_e) {
    return JSON.stringify({ error: 'unserializable' });
  }
}

function normalizeToolResponseMessage({ toolFormat, toolCall, result }) {
  const content = typeof result === 'string' ? result : safeJsonStringify(result);
  if (toolFormat === 'functions') {
    return { role: 'function', name: toolCall.name, content };
  }
  // tools format
  return {
    role: 'tool',
    tool_call_id: toolCall.id || undefined,
    content,
  };
}

export class PromptRouter {
  constructor({
    llmConfig = null,
    llmClient = null,
    toolExecutor,
    auditDir = 'onchain/prompt/audit',
    maxSteps = 12,
  }) {
    if (!toolExecutor) throw new Error('PromptRouter requires toolExecutor');

    this.toolExecutor = toolExecutor;
    this.auditDir = auditDir;
    this.maxSteps = maxSteps;

    const cfg = llmConfig || loadLlmConfigFromEnv();
    this.llmConfig = cfg;

    this.llmClient =
      llmClient ||
      new OpenAICompatibleClient({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        defaultModel: cfg.model,
        timeoutMs: cfg.timeoutMs,
        toolFormat: cfg.toolFormat,
      });

    this._sessions = new Map(); // sessionId -> { messages }
  }

  _getSession(sessionId) {
    const id = sessionId || randomUUID();
    if (!this._sessions.has(id)) {
      this._sessions.set(id, { messages: [{ role: 'system', content: INTERCOMSWAP_SYSTEM_PROMPT }] });
    }
    return { id, session: this._sessions.get(id) };
  }

  async run({
    prompt,
    sessionId = null,
    autoApprove = false,
    dryRun = false,
    maxSteps = null,
  }) {
    const p = String(prompt ?? '').trim();
    if (!p) throw new Error('prompt is required');

    const { id, session } = this._getSession(sessionId);
    const audit = new AuditLog({ dir: this.auditDir, sessionId: id });
    audit.write('prompt', { sessionId: id, prompt: p, autoApprove, dryRun });

    const tools = INTERCOMSWAP_TOOLS;
    const toolFormat = this.llmConfig.toolFormat === 'functions' ? 'functions' : 'tools';

    session.messages.push({ role: 'user', content: p });

    const steps = [];
    const max = maxSteps ?? this.maxSteps;

    for (let i = 0; i < max; i += 1) {
      const startedAt = nowMs();
      const llmOut = await this.llmClient.chatCompletions({
        messages: session.messages,
        tools,
        toolChoice: 'auto',
        maxTokens: this.llmConfig.maxTokens,
        temperature: this.llmConfig.temperature,
        topP: this.llmConfig.topP,
        topK: this.llmConfig.topK,
        minP: this.llmConfig.minP,
        repetitionPenalty: this.llmConfig.repetitionPenalty,
      });

      const llmStep = {
        type: 'llm',
        i,
        started_at: startedAt,
        duration_ms: nowMs() - startedAt,
        finish_reason: llmOut.finishReason,
        content: llmOut.content || '',
        tool_calls: llmOut.toolCalls,
      };
      steps.push(llmStep);
      audit.write('llm_response', llmStep);

      // If there are tool calls, execute them, append tool results, and loop.
      if (Array.isArray(llmOut.toolCalls) && llmOut.toolCalls.length > 0) {
        for (const call of llmOut.toolCalls) {
          if (!call || typeof call.name !== 'string') {
            throw new Error('Invalid tool call (missing name)');
          }
          if (call.parseError) {
            throw new Error(`Tool call arguments parse error for ${call.name}: ${call.parseError}`);
          }
          if (!call.arguments || typeof call.arguments !== 'object') {
            throw new Error(`Tool call missing arguments for ${call.name}`);
          }

          const toolStartedAt = nowMs();
          audit.write('tool_call', { name: call.name, arguments: call.arguments, dryRun, autoApprove });
          const toolResult = await this.toolExecutor.execute(call.name, call.arguments, {
            autoApprove,
            dryRun,
          });
          const toolStep = {
            type: 'tool',
            name: call.name,
            arguments: call.arguments,
            started_at: toolStartedAt,
            duration_ms: nowMs() - toolStartedAt,
            result: toolResult,
          };
          steps.push(toolStep);
          audit.write('tool_result', toolStep);

          // Append tool result as a message so the model can continue.
          session.messages.push(normalizeToolResponseMessage({ toolFormat, toolCall: call, result: toolResult }));
        }
        continue;
      }

      // Otherwise, we have a final assistant message.
      if (llmOut.message && typeof llmOut.message === 'object') session.messages.push(llmOut.message);
      audit.write('final', { content: llmOut.content || '' });
      return { session_id: id, content: llmOut.content || '', steps };
    }

    throw new Error(`Max steps exceeded (${max})`);
  }
}

