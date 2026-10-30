import { AppError } from '../../http/errors';

const MAX_TOKENS_HINT =
  '模型在输出上限内未产生正文，可能是推理过程耗尽了 token 额度。请在模型管理中调大 Max Tokens 后重试。';

/**
 * Builds an actionable error when a provider finishes a stream without any text.
 * Reasoning models can consume the whole output budget before emitting content,
 * which otherwise surfaces as the orchestrator's generic “empty output” error.
 */
export function emptyOutputError(
  maxTokens: number,
  reason: string | null | undefined,
): AppError {
  if (reason === 'max_tokens' || reason === 'length') {
    return new AppError(
      502,
      'LLM_ERROR',
      `模型在 ${maxTokens} tokens 上限内未返回正文：${MAX_TOKENS_HINT}`,
    );
  }
  const suffix = reason ? `（stop_reason: ${reason}）` : '';
  return new AppError(502, 'LLM_ERROR', `模型未返回文本内容${suffix}`);
}
